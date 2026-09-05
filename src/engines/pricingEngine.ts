import { getDatabase, PricingMatrixRule, RouteTemplate } from '../database/db';

interface PricingInput {
  liveKm: number;
  deadKm: number;
  liveDurationMinutes: number;
  totalDurationMinutes: number;
  vehicleId: string;
  journeyType: string;
  passengers: number;
  suitcaseCount?: number;
  handbagCount?: number;
  originName: string;
  destinationName: string;
  originCoords?: {lat: number, lng: number} | null;
  destinationCoords?: {lat: number, lng: number} | null;
  waypoints?: {lat: number, lng: number}[] | null;
  waitingMins: number;
  departureDate: string;
  returnDate?: string;
  journeyClass?: 'ONE_WAY' | 'SAME_DAY_RETURN' | 'MULTI_DAY_RETURN' | 'SPLIT_RETURN';
}

export class PricingConfigurationError extends Error {
  constructor(message: string) {
    super(`Pricing configuration error: ${message}`);
    this.name = 'PricingConfigurationError';
  }
}

function configuredNumber(label: string, values: unknown[], options: { positive?: boolean, allowNegative?: boolean } = {}) {
  const value = values
    .filter(candidate => candidate !== null && candidate !== undefined && candidate !== '')
    .map(candidate => Number(candidate))
    .find(candidate => Number.isFinite(candidate) &&
      (options.positive ? candidate > 0 : options.allowNegative ? true : candidate >= 0));
  if (value === undefined) {
    throw new PricingConfigurationError(`${label} is missing or invalid`);
  }
  return value;
}


// Mirrors the lifecycle calculation shown in Admin. Missing Admin values must
// fail clearly instead of silently introducing a Backend-only cost.
function perKmCostFromAdmin(direct: unknown, setCost: unknown, expectedLifeKm: unknown, label: string) {
  const directValue = Number(direct);
  if (directValue > 0) return directValue;
  const set = Number(setCost);
  const life = Number(expectedLifeKm);
  if (set > 0 && life > 0) return set / life;
  throw new PricingConfigurationError(`${label} is missing or invalid`);
}

function haversineKm(a: {lat: number, lng: number}, b: {lat: number, lng: number}) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
    throw new PricingConfigurationError('location coordinates are missing or invalid');
  }
  const R = 6371; 
  const dLa = (b.lat - a.lat) * Math.PI / 180;
  const dLo = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLa/2)**2 + Math.cos(a.lat*Math.PI/180) * Math.cos(b.lat*Math.PI/180) * Math.sin(dLo/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

function matchLocation(coord: {lat: number, lng: number} | null | undefined, name: string | null | undefined, ruleGeo: {lat: number, lng: number} | null | undefined, ruleName: string | null | undefined, radiusKm: number) {
  const normRuleName = ruleName || 'Any';
  if (normRuleName.toLowerCase() === 'any') return true;

  if (radiusKm > 0 && ruleGeo && ruleGeo.lat && coord && coord.lat) {
    if (haversineKm(coord, ruleGeo) <= radiusKm) {
      return true;
    }
  }

  const normName = name || '';
  const n1 = normName.toLowerCase().trim();
  const n2 = normRuleName.toLowerCase().trim();
  if (n1.includes(n2) || n2.includes(n1)) return true;

  // Also check if they share the first part before comma (e.g. "Heathrow Airport" matches "Heathrow Airport, Hounslow, UK")
  const part1 = n1.split(',')[0].trim();
  const part2 = n2.split(',')[0].trim();
  if (part1 && part2 && (part1.includes(part2) || part2.includes(part1))) return true;

  return false;
}

function calculateOperatingDays(departureDate: string, returnDate?: string) {
  if (!returnDate) return 1;
  const departure = new Date(departureDate);
  const returning = new Date(returnDate);
  if (Number.isNaN(departure.getTime()) || Number.isNaN(returning.getTime()) || returning <= departure) return 1;
  const [departureYear, departureMonth, departureDateOfMonth] = departureDate.slice(0, 10).split('-').map(Number);
  const [returnYear, returnMonth, returnDateOfMonth] = returnDate.slice(0, 10).split('-').map(Number);
  const departureDay = Date.UTC(departureYear, departureMonth - 1, departureDateOfMonth);
  const returnDay = Date.UTC(returnYear, returnMonth - 1, returnDateOfMonth);
  return Math.max(1, Math.round((returnDay - departureDay) / 86400000) + 1);
}

function getAnnualFixedCost(vehicle: any) {
  const costs = Array.isArray(vehicle.annualFixedCosts) && vehicle.annualFixedCosts.length > 0
    ? vehicle.annualFixedCosts
    : (vehicle.annualCosts || []);
  if (!Array.isArray(costs)) throw new PricingConfigurationError('vehicle annual costs must be an array');
  return costs.reduce((sum: number, cost: any) =>
    sum + configuredNumber('vehicle annual fixed cost', [cost?.amount, cost?.cost]), 0);
}

export function fleetEconomics(dbData: any) {
  const companyOverheads = Array.isArray(dbData.annualOverheads)
    ? dbData.annualOverheads.reduce((s: number, o: any) => s + (Number.isFinite(Number(o.cost)) ? Number(o.cost) : 0), 0)
    : 0;
  const totalFleetUnits = Array.isArray(dbData.vehicles)
    ? dbData.vehicles.reduce((s: number, v: any) => s + (Number(v.fleetCount) > 0 ? Number(v.fleetCount) : 0), 0)
    : 0;
  const overheadPerUnit = totalFleetUnits > 0 ? companyOverheads / totalFleetUnits : 0;

  const vehicleBreakdown = dbData.vehicles?.map((v: any) => {
    const count = Number(v.fleetCount) > 0 ? Number(v.fleetCount) : 0;
    const utilDays = Number(v.utilisationDays) > 0 ? Number(v.utilisationDays) : 0;
    const totalAnnualFixed = getAnnualFixedCost(v);
    const annualFixed = count > 0 ? totalAnnualFixed / count : 0;
    const dailyStanding = utilDays > 0 ? annualFixed / utilDays : 0;
    const dailyOverhead = utilDays > 0 ? overheadPerUnit / utilDays : 0;
    const minHirePerDay = dailyStanding + dailyOverhead;

    return {
      id: v.id,
      name: v.name,
      emoji: v.emoji,
      utilDays: utilDays,
      utilRate: Math.round((utilDays / 365) * 100),
      count: count,
      annualFixed: annualFixed,
      dailyStanding: dailyStanding,
      dailyOverhead: dailyOverhead,
      minHirePerDay: Math.round(minHirePerDay * 100) / 100
    };
  }) || [];

  return { vehicleBreakdown, companyOverheads, overheadPerUnit, totalFleetUnits };
}

export async function calculatePrice(input: PricingInput, env: any) {
  const db = await getDatabase(env);
  return calculatePriceFromData(input, db.data);
}

export function calculatePriceFromData(input: PricingInput, data: any) {
  if (!data || !Array.isArray(data.vehicles)) throw new Error("Database not initialized");

  const {
    liveKm, deadKm, vehicleId, journeyType, originName, destinationName, originCoords, destinationCoords, waitingMins, departureDate, returnDate
  } = input;

  const numericInputs: Array<[string, unknown]> = [
    ['live mileage', liveKm],
    ['dead mileage', deadKm],
    ['live duration', input.liveDurationMinutes],
    ['total duration', input.totalDurationMinutes],
    ['waiting time', waitingMins],
    ['passenger count', input.passengers]
  ];
  for (const [label, value] of numericInputs) configuredNumber(label, [value]);
  if (!['one-way', 'return'].includes(journeyType)) throw new Error('Journey type must be one-way or return');
  if (!originName?.trim() || !destinationName?.trim()) throw new Error('Pickup and destination are required');
  if (Number.isNaN(new Date(departureDate).getTime())) throw new Error('A valid departure date is required');
  if (journeyType === 'return' && (!returnDate || new Date(returnDate) <= new Date(departureDate))) {
    throw new Error('Return date must be after the departure date');
  }

  const vehicle = data.vehicles.find((v: any) => v.id === vehicleId);
  if (!vehicle) throw new Error("Vehicle not found");
  const isCostPlus = vehicle.fareCalculationMethod === 'cost-plus';
  const isStandardBus = vehicleId === 'bus' || vehicle.id === 'bus' || String(vehicle.name || '').toLowerCase().includes('standard bus');
  const departureForRates = new Date(departureDate);
  const isWeekendDeparture =
    !Number.isNaN(departureForRates.getTime()) &&
    (departureForRates.getDay() === 0 || departureForRates.getDay() === 6);
  const isHolidayDeparture = (data.seasonalPricing || []).some((season: any) =>
    season.enabled &&
    new Date(season.startDate) <= departureForRates &&
    new Date(season.endDate) >= departureForRates
  );

  // 1. Check Route Templates (Radius Match or Exact Match)
  const distanceUnit = data.globalVars?.distanceUnit;
  if (distanceUnit !== 'km' && distanceUnit !== 'miles') {
    throw new PricingConfigurationError('distance unit must be configured as km or miles');
  }
  const templateRadiusFactor = distanceUnit === 'miles' ? 1.60934 : 1;
  const template = !isCostPlus && (Array.isArray(data.routeTemplates) ? data.routeTemplates : []).find((t: RouteTemplate) => 
    t.vehicleId === vehicleId && 
    t.tripType === journeyType &&
    matchLocation(originCoords, originName, t.pickupGeo, t.pickupArea, Number(t.radiusKm || 0) * templateRadiusFactor) &&
    matchLocation(destinationCoords, destinationName, t.dropGeo, t.dropArea, Number(t.radiusKm || 0) * templateRadiusFactor)
  );

  let baseFare = 0;
  let waitingCharge = 0;
  let extraLiveMileageCharge = 0;
  let extraDeadMileageCharge = 0;
  let isManualQuote = false;
  let preSurchargeBase = 0;
  let driverCost = 0;
  let dualCrew = false;
  let distanceCost = 0;
  let standingCost = 0;
  let overnightCost = 0;
  let appliedMarginPct = 0;
  let appliedDriverRate = 0;
  let waitingHours = 0;
  let mandatoryBreakHours = 0;
  let commercialMinimumHire = 0;
  let commercialSellingRate = 0;
  let commercialIncludedKm = 0;
  let commercialMileageCharge = 0;

  const gv = { ...(data.globalVars || {}), ...(vehicle.pricingSettings || {}) };
  const totalKm = liveKm + deadKm;
  // Fuel price/economy fall back to the same defaults Admin itself uses when
  // a vehicle hasn't been fully configured (1.52/L, 5 km/L), so an
  // incomplete vehicle degrades to an approximate running cost instead of
  // refusing to price the trip at all.
  const fuelPrice = configuredNumber('fuel price per litre', [vehicle.fuelPricePerLitre, gv.fuelPricePerLitre]);
  const fuelKpl = configuredNumber('vehicle fuel economy', [vehicle.fuelKpl], { positive: true });
  const maintenanceCostPerKm = perKmCostFromAdmin(
    vehicle.maintenanceCostPerKm, vehicle.maintenanceSetCost, vehicle.expectedMaintenanceLifeKm, 'maintenance cost per km'
  );
  const tyreCostPerKm = perKmCostFromAdmin(
    vehicle.tyreCostPerKm, vehicle.tyreSetCost, vehicle.expectedTyreLifeKm, 'tyre cost per km'
  );
  const physicalOperatingRate = (fuelPrice / fuelKpl) + maintenanceCostPerKm + tyreCostPerKm;
  // vehicle.ratePerKm is only needed in the rare case none of the above
  // produced a usable rate — only require it then, not unconditionally.
  const vehicleRate = physicalOperatingRate > 0 ? 0 : configuredNumber('vehicle operating rate per km', [vehicle.ratePerKm], { positive: true });
  distanceCost = totalKm * (physicalOperatingRate > 0 ? physicalOperatingRate : vehicleRate);
  const fuelCost = totalKm * (fuelPrice / fuelKpl);
  const maintenanceCost = totalKm * maintenanceCostPerKm;
  const tyreCost = totalKm * tyreCostPerKm;
  const atomicMileageCost = fuelCost + maintenanceCost + tyreCost;

  // Driver must walk around the vehicle for a safety check before leaving the
  // yard and after returning, on top of the routed driving time.
  const walkaroundHours = (configuredNumber('walkaround check minutes', [gv.walkaroundCheckMinutes]) * 2) / 60;
  const drivingHours = (input.totalDurationMinutes / 60) + walkaroundHours;
  const operatingDays = calculateOperatingDays(departureDate, returnDate);
  const requestedWaitingHours = (Number(waitingMins) || 0) / 60;
  waitingHours = requestedWaitingHours;
  
  const configuredDriverWage = isHolidayDeparture
    ? gv.driverWageHoliday
    : isWeekendDeparture
      ? gv.driverWageWeekend
      : gv.driverWageWeekday;
  const driverWage = configuredNumber('driver hourly wage', [configuredDriverWage, gv.driverHourlyWage], { positive: true });
  appliedDriverRate = driverWage;
  // A zero factor is valid when waiting time should not add wage cost.
  const waitingFactor = configuredNumber('waiting wage factor', [gv.waitingWageFactor]);
  const dailyDrivingHours = drivingHours / operatingDays;
  const dailyDrivingLimitEnabled = gv.dailyDrivingLimitEnabled !== false;
  const dailyDrivingLimit = dailyDrivingLimitEnabled ? configuredNumber('daily driving limit', [gv.dualDriverThresholdHours], { positive: true }) : 0;
  const driverCount = dailyDrivingLimitEnabled ? Math.max(1, Math.ceil(dailyDrivingHours / dailyDrivingLimit)) : 1;
  dualCrew = driverCount > 1;
  // These values mirror the two visible Admin pricing controls. Preserve any
  // existing disabled policy without requiring a hidden flag to price quotes.
  const breakTriggerEnabled = gv.drivingBreakTriggerEnabled === true;
  const breakDurationEnabled = gv.drivingBreakDurationEnabled === true;
  const breakTriggerHours = breakTriggerEnabled ? configuredNumber('driving break trigger hours', [gv.drivingBreakTriggerHours], { positive: true }) : 0;
  const breakDurationHours = breakDurationEnabled ? configuredNumber('driving break duration minutes', [gv.drivingBreakMinutes], { positive: true }) / 60 : 0;
  const drivingBreakHours = breakTriggerEnabled && breakDurationEnabled ? Math.floor(Math.max(0, dailyDrivingHours - Number.EPSILON) / breakTriggerHours) * breakDurationHours * operatingDays : 0;
  const workingHours = drivingHours + waitingHours;
  const dailyWorkingHours = workingHours / operatingDays;
  mandatoryBreakHours = drivingBreakHours;
  driverCost = ((drivingHours + mandatoryBreakHours) * driverWage + waitingHours * driverWage * waitingFactor) * driverCount;

  if (template) {
    baseFare = configuredNumber('route template price', [template.price]);
    const templateWaitingRate = Number(waitingMins) > 0
      ? configuredNumber('template waiting charge per hour', [template.waitingChargePerHour, data.globalVars?.waitingChargePerHour])
      : 0;
    waitingCharge = (waitingMins / 60) * templateWaitingRate;
    preSurchargeBase = baseFare + waitingCharge;
  } else {
    
    const matrixRules = Array.isArray(data.pricingMatrix) ? data.pricingMatrix : [];
    const invalidScope = matrixRules.find((m: any) => m.status === 'active' && !['global', 'fleet', 'city'].includes(m.scope));
    if (invalidScope) throw new PricingConfigurationError(`pricing matrix rule ${invalidScope.id || ''} has no valid scope`);
    const inferMatrixScope = (m: any) => m.scope;
    const scopePriority: Record<string, number> = { city: 3, fleet: 2, global: 1 };
    const matrix = !isCostPlus && [...matrixRules]
      .sort((a: any, b: any) => scopePriority[inferMatrixScope(b)] - scopePriority[inferMatrixScope(a)])
      .find((m: any) => {
      const inferredScope = inferMatrixScope(m);
      const tripMatches = m.tripType === journeyType || m.tripType === 'any';
      const vehicleMatches = inferredScope === 'global' ||
        (inferredScope === 'fleet' ? m.vehicleId === vehicleId : (!m.vehicleId || m.vehicleId === vehicleId));
      const routeMatches = inferredScope !== 'city' || (
        matchLocation(originCoords, originName, m.pickupGeo, m.pickupArea, 0) &&
        matchLocation(destinationCoords, destinationName, m.dropGeo, m.dropArea, 0)
      );
      return m.status === 'active' && tripMatches && vehicleMatches && routeMatches;
    });

    if (matrix) {
      baseFare = configuredNumber('pricing matrix base fare', [matrix.baseFare]);
      const matrixDistanceFactor = distanceUnit === 'miles' ? 1 / 1.60934 : 1;
      const matrixRateFactor = distanceUnit === 'miles' ? 1 / 1.60934 : 1;
      const totalDistance = (Number(liveKm) + Number(deadKm)) * matrixDistanceFactor;
      if (!Array.isArray(matrix.distanceBands) || matrix.distanceBands.length === 0) {
        throw new PricingConfigurationError(`pricing matrix rule ${matrix.id || ''} requires stored distance bands`);
      }
      const configuredBand = matrix.distanceBands.find((band: any) =>
            totalDistance >= Number(band.min) &&
            (band.max === null || band.max === undefined || totalDistance < Number(band.max))
          );
      if (!configuredBand) {
        throw new PricingConfigurationError(`pricing matrix rule ${matrix.id || ''} has no band for ${totalDistance} ${distanceUnit}`);
      }
      const mileageRate = configuredNumber('pricing matrix distance-band rate', [configuredBand.rate]) * matrixRateFactor;
      const includedLiveMileage = configuredNumber('included live mileage', [matrix.includedLiveMileage]) / matrixDistanceFactor;
      const includedDeadMileage = configuredNumber('included dead mileage', [matrix.includedDeadMileage]) / matrixDistanceFactor;
      const waitingRate = configuredNumber('pricing matrix waiting charge', [matrix.waitingChargePerHour]);
      const weekendMultiplier = configuredNumber('pricing matrix weekend multiplier', [matrix.weekendRateMultiplier], { positive: true });
      const nightMultiplier = configuredNumber('pricing matrix night multiplier', [matrix.nightRateMultiplier], { positive: true });
      const extraLive = Math.max(0, liveKm - includedLiveMileage);
      extraLiveMileageCharge = extraLive * mileageRate;

      const extraDead = Math.max(0, deadKm - includedDeadMileage);
      extraDeadMileageCharge = extraDead * mileageRate;

      waitingCharge = (waitingMins / 60) * waitingRate;
      preSurchargeBase = baseFare + extraLiveMileageCharge + extraDeadMileageCharge + waitingCharge;

      const departure = new Date(departureDate);
      if (!Number.isNaN(departure.getTime())) {
        const isWeekend = departure.getDay() === 0 || departure.getDay() === 6;
        const hour = departure.getHours();
        const isNight = hour < 6 || hour >= 22;
        if (isWeekend) preSurchargeBase *= weekendMultiplier;
        if (isNight) preSurchargeBase *= nightMultiplier;
      }
    } else {

      isManualQuote = true;

      // Vehicle standing is allocated below from annual fixed costs, fleet
      // count, utilisation days, and operating days.
      overnightCost = 0;
      // These, like minimum hire above, degrade to a safe default instead of
      // refusing the quote when unset — the profit floor below still catches
      // underpricing, so a config gap here should reduce quote quality, not
      // block the customer from getting a price at all.
      waitingCharge = waitingHours * configuredNumber('waiting charge per hour', [gv.waitingChargePerHour]);
      const sellingRate = isCostPlus ? 0 : configuredNumber(
        `${journeyType} selling rate`,
        [journeyType === 'return' ? vehicle.sellingRateReturn : vehicle.sellingRateOneWay],
        { positive: true }
      );
      const includedKm = isCostPlus ? 0 : configuredNumber(
        `${journeyType} included mileage`,
        [journeyType === 'return' ? vehicle.includedKmReturn : vehicle.includedKmOneWay]
      );
      // vehicle.minimumHire is normally kept in sync by the admin config save
      // (see admin_configController.ts) and falls back to computing it live
      // from fleet economics. If neither is available (fleet count,
      // utilisation days or annual costs still incomplete for this vehicle),
      // degrade to 0 rather than refusing the quote — the accounting-cost
      // profit floor below still guarantees the customer is never quoted
      // below cost, so a missing minimum-hire figure should never be the
      // thing that blocks a customer from getting a price.
      const liveMinHireEco = fleetEconomics(data).vehicleBreakdown.find((v: any) => v.id === vehicleId);
      const liveMinHire = isStandardBus ? (Number(liveMinHireEco?.dailyOverhead) || 0) : (Number(liveMinHireEco?.minHirePerDay) || 0);
      // Fleet economics is authoritative; a previously stored manual value must
      // not survive an overhead, fleet-count, or utilisation change.
      const minimumHire = Number(liveMinHire) > 0 ? Number(liveMinHire) : 0;
      commercialMinimumHire = isCostPlus ? 0 : minimumHire;
      commercialSellingRate = isCostPlus ? 0 : sellingRate;
      commercialIncludedKm = isCostPlus ? 0 : includedKm;
      commercialMileageCharge = isCostPlus ? 0 : Math.max(0, totalKm - includedKm) * sellingRate;
      baseFare = isCostPlus
        ? 0
        : minimumHire + Math.max(0, totalKm - includedKm) * sellingRate;
      preSurchargeBase = baseFare + waitingCharge;
    }
  }

  const surcharges = vehicle.pricingSurcharges || data.surcharges || {};
  let surchargeTotal = 0;
  let surchargeLines: {label: string, cost: number}[] = [];

  const londonCenter = {lat: 51.5074, lng: -0.1278};
  const goesLondon = (originCoords && haversineKm(originCoords, londonCenter) < 35) || 
                     (destinationCoords && haversineKm(destinationCoords, londonCenter) < 35) ||
                     originName?.toLowerCase().includes("london") || destinationName?.toLowerCase().includes("london");

  const birmCenter = {lat: 52.4862, lng: -1.8904};
  const goesBirm = (originCoords && haversineKm(originCoords, birmCenter) < 10) || 
                   (destinationCoords && haversineKm(destinationCoords, birmCenter) < 10) ||
                   originName?.toLowerCase().includes("birmingham") || destinationName?.toLowerCase().includes("birmingham");

  const dartfordCenter = {lat: 51.4614, lng: 0.2261};
  const goesDartford = (originCoords && haversineKm(originCoords, dartfordCenter) < 15) || 
                       (destinationCoords && haversineKm(destinationCoords, dartfordCenter) < 15) ||
                       originName?.toLowerCase().includes("dartford") || destinationName?.toLowerCase().includes("dartford");

  if (goesLondon) {
    const cost = configuredNumber('London ULEZ surcharge', [surcharges.ulez]);
    surchargeTotal += cost;
    if (cost > 0) surchargeLines.push({ label: "London ULEZ / CAZ", cost });
  }
  if (goesBirm) {
    const cost = configuredNumber('Birmingham CAZ surcharge', [surcharges.birminghamCaz]);
    surchargeTotal += cost;
    if (cost > 0) surchargeLines.push({ label: "Birmingham CAZ", cost });
  }
  if (goesDartford) {
    const cost = configuredNumber('Dartford surcharge', [surcharges.dartford]);
    surchargeTotal += cost;
    if (cost > 0) surchargeLines.push({ label: "Dartford Crossing", cost });
  }


  let finalFare = preSurchargeBase + surchargeTotal;

  if (isManualQuote) finalFare = preSurchargeBase + surchargeTotal;

  const commercialWeight = Number(vehicle.commercialWeight);
  if (!isCostPlus && !isManualQuote && Number.isFinite(commercialWeight) && commercialWeight > 0) {
    finalFare *= commercialWeight;
  }

  const suitcaseCount = Number(input.suitcaseCount) || 0;
  const handbagCount = Number(input.handbagCount) || 0;
  const cap = configuredNumber('vehicle capacity', [vehicle.capacity], { positive: true });

  const extraSuitcases = Math.max(0, suitcaseCount - cap);
  const extraHandbags = Math.max(0, handbagCount - cap);
  const totalExtraBags = extraSuitcases + extraHandbags;

  if (totalExtraBags > 0) {
    const extraLuggagePct = configuredNumber('extra luggage percentage', [vehicle?.extraLuggageProfitPct, gv.extraLuggageProfitPct]);
    const extraLuggageMultiplier = 1 + (totalExtraBags * extraLuggagePct) / 100;
    finalFare = finalFare * extraLuggageMultiplier;
  }

  let seasonalMultiplier = 1;
  const depDateObj = new Date(departureDate);

  const applicableSeasons = (data.seasonalPricing || []).filter((s: any) => {
    const vehicleMatches =
      !Array.isArray(s.applicableVehicles) ||
      s.applicableVehicles.length === 0 ||
      s.applicableVehicles.includes('Any') ||
      s.applicableVehicles.includes(vehicleId);
    const routeMatches =
      !Array.isArray(s.applicableRoutes) ||
      s.applicableRoutes.length === 0 ||
      s.applicableRoutes.includes('Any') ||
      s.applicableRoutes.some((route: string) => {
        const normalized = String(route).toLowerCase();
        return normalized === `${originName} → ${destinationName}`.toLowerCase() ||
          normalized === `${originName} -> ${destinationName}`.toLowerCase();
      });
    return s.enabled &&
      new Date(s.startDate) <= depDateObj &&
      new Date(s.endDate) >= depDateObj &&
      vehicleMatches &&
      routeMatches;
  }).sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0));

  if (applicableSeasons.length > 0) {
    const season = applicableSeasons[0];
    if (season.overrideFare != null) {
      finalFare = Number(season.overrideFare) + surchargeTotal;
      extraLiveMileageCharge = 0;
      extraDeadMileageCharge = 0;
    } else if (season.multiplier) {
      seasonalMultiplier = season.multiplier;
      finalFare = finalFare * seasonalMultiplier;
    }
  }

  const vehicleEconomics = fleetEconomics(data).vehicleBreakdown.find((item: any) => item.id === vehicleId);
  const rawStanding = isStandardBus ? 0 : (Number(vehicleEconomics?.dailyStanding) || 0);
  const allocatedStanding = rawStanding * operatingDays;
  const allocatedOverhead = (Number(vehicleEconomics?.dailyOverhead) || 0) * operatingDays;
  if (!isManualQuote) standingCost = Math.round(allocatedStanding * 100) / 100;
  const totalOperatingCost = atomicMileageCost + driverCost + standingCost + overnightCost + (isManualQuote ? allocatedStanding : 0) + allocatedOverhead + surchargeTotal;
  const netMarginPct = configuredNumber('net margin percentage', [gv.netMarginPct]);
  if (netMarginPct >= 100) throw new PricingConfigurationError('net margin percentage must be less than 100');
  const netProfitTarget = configuredNumber('minimum net profit', [gv.netProfitTarget]);
  const profitFloor = Math.max(totalOperatingCost / (1 - netMarginPct / 100), totalOperatingCost + netProfitTarget);
  finalFare = isCostPlus ? (profitFloor + waitingCharge) : Math.max(finalFare, profitFloor);

    const roundedFinalFare = Math.ceil(finalFare / 5) * 5;
    const customerRangeEnabled = gv.customerRangeUpliftEnabled !== false;
    const customerRangePct = customerRangeEnabled ? configuredNumber('customer price range percentage', [gv.customerRangePct]) : 0;
    const upperBoundFare = customerRangeEnabled ? finalFare * (1 + customerRangePct / 100) : roundedFinalFare;

    return {
      baseFare: Math.round(baseFare),
      extraLiveMileageCharge: Math.round(extraLiveMileageCharge),
      extraDeadMileageCharge: Math.round(extraDeadMileageCharge),
      waitingCharge: Math.round(waitingCharge),
      seasonalMultiplier,
      surchargeTotal: Math.round(surchargeTotal),
      surchargeLines,
      driverCost: Math.round(driverCost),
      dualCrew,
      finalFare: roundedFinalFare,
      upperBoundFare: Math.round(upperBoundFare),
      isManualQuote,
      pricingMethod: template ? 'fixed-route' : isManualQuote ? 'cost-model' : 'pricing-matrix',
      breakdown: {
        fareCalculationMethod: vehicle.fareCalculationMethod === 'cost-plus' ? 'cost-plus' : 'commercial',
        minimumHire: Math.round(commercialMinimumHire * 100) / 100,
        sellingRate: Math.round(commercialSellingRate * 100) / 100,
        includedMileage: Math.round(commercialIncludedKm * 100) / 100,
        commercialMileageCharge: Math.round(commercialMileageCharge * 100) / 100,
        commercialFareBeforeProfitFloor: Math.round((preSurchargeBase + surchargeTotal) * 100) / 100,
        distanceCost: Math.round(distanceCost * 100) / 100,
        atomicMileageCost: Math.round(atomicMileageCost * 100) / 100,
        liveDistanceCost: Math.round((totalKm > 0 ? distanceCost * liveKm / totalKm : 0) * 100) / 100,
        deadDistanceCost: Math.round((totalKm > 0 ? distanceCost * deadKm / totalKm : 0) * 100) / 100,
        fuelCost: Math.round(fuelCost * 100) / 100,
        maintenanceCost: Math.round(maintenanceCost * 100) / 100,
        tyreCost: Math.round(tyreCost * 100) / 100,
        totalOperatingCost: Math.round(totalOperatingCost * 100) / 100,
        driverCost: Math.round(driverCost * 100) / 100,
        standingCost,
        overnightCost,
        commercialWeight: Number.isFinite(commercialWeight) && commercialWeight > 0 ? commercialWeight : 1,
        marginPct: appliedMarginPct,
        netMarginPct,
        netProfitTarget,
        profitFloor: Math.round(profitFloor * 100) / 100,
        allocatedStanding: Math.round(allocatedStanding * 100) / 100,
        allocatedOverhead: Math.round(allocatedOverhead * 100) / 100,
        driverRate: appliedDriverRate,
        driverCount,
        dailyDrivingLimit,
        mandatoryBreakHours,
        waitingHours,
        surchargeTotal: Math.round(surchargeTotal * 100) / 100,
        customerRangePct
      }
    };
}
