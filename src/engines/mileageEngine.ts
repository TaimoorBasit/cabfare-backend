import { getDatabase } from '../database/db';

export class MileageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MileageUnavailableError';
  }
}

export async function getDirections(origin: any, destination: any, waypoints: any[] = [], apiKey: string) {
  if (!apiKey) throw new Error("Google Maps API key is required");

  let waypointsStr = '';
  if (waypoints.length > 0) {
    waypointsStr = '&waypoints=' + waypoints.map(w => formatLoc(w)).join('|');
  }

  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${formatLoc(origin)}&destination=${formatLoc(destination)}${waypointsStr}&key=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Maps API error: ${res.statusText}`);

  const data: any = await res.json();
  if (data.status !== 'OK') {
    throw new Error(`Google Maps API failed: ${data.status} - ${data.error_message || ''}`);
  }

  return data;
}

function formatLoc(loc: any) {
  if (typeof loc === 'string' && loc.trim()) return encodeURIComponent(loc.trim());
  if (loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng))) {
    return `${Number(loc.lat)},${Number(loc.lng)}`;
  }
  throw new Error('A valid route location is required');
}

const mileageCache = new Map<string, any>();

export async function calculateMileage(journey: any, env: any) {
  const db = await getDatabase(env);
  const apiKey = env?.GOOGLE_MAPS_API_KEY || '';
  if (!apiKey) {
    throw new MileageUnavailableError('Mileage calculation is unavailable: GOOGLE_MAPS_API_KEY is not configured');
  }

  const { origin, destination, waypoints, stops = [] } = journey;
  const yardLat = Number(db.data?.globalVars?.yardLat);
  const yardLng = Number(db.data?.globalVars?.yardLng);
  const yardAddress = String(db.data?.globalVars?.yardAddress || '').trim();
  const yardLoc = Number.isFinite(yardLat) && Number.isFinite(yardLng)
    ? { lat: yardLat, lng: yardLng }
    : yardAddress || null;
  if (!yardLoc) {
    throw new MileageUnavailableError('Mileage calculation is unavailable: a depot/yard location is not configured');
  }

  // Build the live route points
  const livePoints = waypoints?.length >= 2 ? waypoints : [origin, destination];
  const liveOrigin = livePoints[0];
  const liveDestination = livePoints[livePoints.length - 1];
  const liveWaypoints = livePoints.slice(1, -1);

  const isReturn = journey.journeyType === 'return';
  const distanceUnit = db.data?.globalVars?.distanceUnit;
  if (distanceUnit !== 'km' && distanceUnit !== 'miles') {
    throw new MileageUnavailableError('Mileage calculation is unavailable: distance unit is not configured');
  }
  const cacheWindow = Math.floor(Date.now() / 900000);
  const cacheKey = JSON.stringify({ liveOrigin, liveDestination, liveWaypoints, yardLoc, isReturn, distanceUnit, cacheWindow });
  if (mileageCache.has(cacheKey)) {
    return await mileageCache.get(cacheKey);
  }

  const mileagePromise = (async () => {
    try {
      
    const liveDirections = await getDirections(liveOrigin, liveDestination, liveWaypoints, apiKey);
    let liveDistanceMeters = sumLegs(liveDirections.routes[0].legs, 'distance');
    let liveDurationSeconds = sumLegs(liveDirections.routes[0].legs, 'duration');
    const divisor = distanceUnit === 'miles' ? 1609.34 : 1000;

    const deadOutDirections = await getDirections(yardLoc, liveOrigin, [], apiKey);
    const deadOutDistanceMeters = sumLegs(deadOutDirections.routes[0].legs, 'distance');
    const deadOutDurationSeconds = sumLegs(deadOutDirections.routes[0].legs, 'duration');

    const isReturn = journey.journeyType === 'return';
    if (isReturn) {
      liveDistanceMeters *= 2;
      liveDurationSeconds *= 2;
    }

    const deadBackDirections = await getDirections(isReturn ? liveOrigin : liveDestination, yardLoc, [], apiKey);
    const deadBackDistanceMeters = sumLegs(deadBackDirections.routes[0].legs, 'distance');
    const deadBackDurationSeconds = sumLegs(deadBackDirections.routes[0].legs, 'duration');

    const liveKm = liveDistanceMeters / divisor;
    const deadKm = (deadOutDistanceMeters + deadBackDistanceMeters) / divisor;

    const result = {
      liveKm,
      deadKm,
      totalKm: liveKm + deadKm,
      liveDurationMinutes: liveDurationSeconds / 60,
      totalDurationMinutes: (liveDurationSeconds + deadOutDurationSeconds + deadBackDurationSeconds) / 60,
      geometry: liveDirections.routes[0].overview_polyline.points,
      legs: liveDirections.routes[0].legs
    };
    return result;
  } catch (error: any) {
    console.error("Mileage engine error:", error);
    throw new MileageUnavailableError(`Unable to calculate the road route: ${error.message}`);
  }
  })();

  mileageCache.set(cacheKey, mileagePromise);
  if (mileageCache.size > 200) {
    const oldestKey = mileageCache.keys().next().value;
    if (oldestKey) mileageCache.delete(oldestKey);
  }
  try {
    return await mileagePromise;
  } catch (error) {
    mileageCache.delete(cacheKey);
    throw error;
  }
}

function sumLegs(legs: any[], key: 'distance'|'duration') {
  return legs.reduce((sum, leg) => sum + leg[key].value, 0);
}

