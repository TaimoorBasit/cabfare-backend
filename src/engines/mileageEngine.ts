import { getDatabase } from '../database/db';

const mapsRequestTimeoutMs = 8000;

export class MileageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MileageUnavailableError';
  }
}

export async function getDirections(origin: any, destination: any, waypoints: any[] = [], apiKey: string) {
  if (!apiKey) throw new Error("Google Maps API key is required");

  const request = async (from: any, to: any, stops: any[]) => {
    const waypointsStr = stops.length > 0
      ? '&waypoints=' + stops.map(w => formatLoc(w)).join('|')
      : '';
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${formatLoc(from)}&destination=${formatLoc(to)}${waypointsStr}&region=uk&key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(mapsRequestTimeoutMs) });
    if (!res.ok) throw new Error(`Google Maps API error: ${res.statusText}`);
    return await res.json() as any;
  };

  let data = await request(origin, destination, waypoints);
  if (data.status === 'NOT_FOUND' || data.status === 'ZERO_RESULTS') {
    const resolved = await Promise.all([origin, ...waypoints, destination].map(loc => geocodeLocation(loc, apiKey)));
    data = await request(resolved[0], resolved[resolved.length - 1], resolved.slice(1, -1));
  }
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

async function geocodeLocation(loc: any, apiKey: string) {
  if (typeof loc !== 'string') return loc;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(loc.trim())}&components=country:GB&region=uk&key=${apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(mapsRequestTimeoutMs) });
  if (!res.ok) throw new Error(`Google Maps geocoding error: ${res.statusText}`);
  const data: any = await res.json();
  const point = data.results?.[0]?.geometry?.location;
  if (data.status !== 'OK' || !point) throw new Error(`Location not found: ${loc}`);
  return point;
}

export function resolveRoutePoints(journey: any) {
  const names = journey.waypoints?.length >= 2
    ? journey.waypoints
    : [journey.origin, journey.destination];
  const coords = Array.isArray(journey.wpCoords) ? journey.wpCoords : [];
  return names.map((name: any, index: number) => coords[index] || name);
}

const mileageCache = new Map<string, any>();
const mileageCacheTtlSeconds = 900;

async function mileageCacheId(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

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
  const livePoints = resolveRoutePoints({ origin, destination, waypoints, wpCoords: journey.wpCoords });
  const liveOrigin = livePoints[0];
  const liveDestination = livePoints[livePoints.length - 1];
  const liveWaypoints = livePoints.slice(1, -1);
  const isReturn = journey.journeyType === 'return';

  const distanceUnit = db.data?.globalVars?.distanceUnit;
  if (distanceUnit !== 'km' && distanceUnit !== 'miles') throw new MileageUnavailableError('Mileage calculation is unavailable: distance unit is not configured');
  const departure = new Date(journey.departureDate);
  const returning = journey.returnDate ? new Date(journey.returnDate) : null;
  const sameCalendarDay = Boolean(returning) && departure.toDateString() === returning!.toDateString();
  const journeyClass = !isReturn ? 'ONE_WAY' : sameCalendarDay ? 'SAME_DAY_RETURN' : 'MULTI_DAY_RETURN';
  const cacheWindow = Math.floor(Date.now() / 900000);
  const emptyLegThresholdKm = Number(journey.emptyLegThresholdKm ?? 20);
  const cacheKey = JSON.stringify({ liveOrigin, liveDestination, liveWaypoints, yardLoc, journeyClass, distanceUnit, emptyLegThresholdKm, cacheWindow });
  if (mileageCache.has(cacheKey)) {
    return await mileageCache.get(cacheKey);
  }

  const durableCache = env?.CABFARE_DB && typeof env.CABFARE_DB.get === 'function' ? env.CABFARE_DB : null;
  const durableKey = `cabfare:mileage:${await mileageCacheId(cacheKey)}`;
  if (durableCache) {
    try {
      const cached = await durableCache.get(durableKey, 'json');
      if (cached) {
        mileageCache.set(cacheKey, Promise.resolve(cached));
        return cached;
      }
    } catch (error) {
      console.warn('Durable mileage cache read failed:', error);
    }
  }

  const mileagePromise = (async () => {
    try {
      
    const [liveDirections, deadOutDirections] = await Promise.all([
      getDirections(liveOrigin, liveDestination, liveWaypoints, apiKey),
      getDirections(yardLoc, liveOrigin, [], apiKey)
    ]);
    let liveDistanceMeters = sumLegs(liveDirections.routes[0].legs, 'distance');
    let liveDurationSeconds = sumLegs(liveDirections.routes[0].legs, 'duration');
    const divisor = 1000;
    const rawDeadOutDistanceMeters = sumLegs(deadOutDirections.routes[0].legs, 'distance');
    const rawDeadOutDurationSeconds = sumLegs(deadOutDirections.routes[0].legs, 'duration');
    const includeDeadOut = rawDeadOutDistanceMeters / 1000 >= emptyLegThresholdKm;
    const deadOutDistanceMeters = includeDeadOut ? rawDeadOutDistanceMeters : 0;
    const deadOutDurationSeconds = includeDeadOut ? rawDeadOutDurationSeconds : 0;
    const automaticWaitingMinutes = journeyClass === 'SAME_DAY_RETURN'
      ? Math.max(0, (new Date(journey.returnDate).getTime() - (departure.getTime() + (deadOutDurationSeconds + liveDurationSeconds) * 1000)) / 60000)
      : 0;

    const returnDirectionsPromise = isReturn
      ? getDirections(liveDestination, liveOrigin, [...liveWaypoints].reverse(), apiKey)
      : Promise.resolve(null);
    const deadBackOrigin = isReturn ? liveOrigin : liveDestination;
    const [returnDirections, deadBackDirections] = await Promise.all([
      returnDirectionsPromise,
      getDirections(deadBackOrigin, yardLoc, [], apiKey)
    ]);
    if (returnDirections) {
      liveDistanceMeters += sumLegs(returnDirections.routes[0].legs, 'distance');
      liveDurationSeconds += sumLegs(returnDirections.routes[0].legs, 'duration');
    }

    // The vehicle starts and finishes at the configured yard for every return booking.
    let deadBackDistanceMeters = 0;
    let deadBackDurationSeconds = 0;
    {
      const rawDeadBackDistanceMeters = sumLegs(deadBackDirections.routes[0].legs, 'distance');
      if (rawDeadBackDistanceMeters / 1000 >= emptyLegThresholdKm) {
        deadBackDistanceMeters = rawDeadBackDistanceMeters;
        deadBackDurationSeconds = sumLegs(deadBackDirections.routes[0].legs, 'duration');
      }
    }

    const liveKm = liveDistanceMeters / divisor;
    const deadKm = (deadOutDistanceMeters + deadBackDistanceMeters) / divisor;

    const result = {
      liveKm,
      deadKm,
      totalKm: liveKm + deadKm,
      liveDurationMinutes: liveDurationSeconds / 60,
      totalDurationMinutes: (liveDurationSeconds + deadOutDurationSeconds + deadBackDurationSeconds) / 60,
      automaticWaitingMinutes,
      journeyClass,
      emptyLegApplied: includeDeadOut,
      emptyLegThresholdKm,
      geometry: liveDirections.routes[0].overview_polyline.points,
      legs: liveDirections.routes[0].legs
    };
    if (durableCache) {
      try {
        await durableCache.put(durableKey, JSON.stringify(result), { expirationTtl: mileageCacheTtlSeconds });
      } catch (error) {
        console.warn('Durable mileage cache write failed:', error);
      }
    }
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

