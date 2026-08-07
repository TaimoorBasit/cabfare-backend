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
  usesM6Toll?: boolean;
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

function haversineKm(a: {lat: number, lng: number}, b: {lat: number, lng: number}) {
  if (!a || !b || !a.lat || !b.lat) return 9999;
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

function roundToNearestFive(value: number) {
  return Math.round(value / 5) * 5;
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

  const departureForRates = new Date(departureDate);
  const isWeekendDeparture =
    !Number.isNaN(departureForRates.getTime()) &&
    (departureForRates.getDay() === 0 || departureForRates.getDay() === 6);
  const isHolidayDeparture = (data.seasonalPricing || []).some((season: any) =>
    season.enabled &&
    new Date(season.startDate) <= departureForRates &&
    new Date(season.endDate) >= departureForRates
  );

  const gv = data.globalVars || {};

  // 1. Core Config
  const distanceUnit = gv.distanceUnit;
  if (distanceUnit !== 'km' && distanceUnit !== 'miles') {
    throw new PricingConfigurationError('distance unit must be configured as km or miles');
  }

  // Calculate Journey Class
  const daysBetween = calculateOperatingDays(departureDate, returnDate);
  const journeyClass = input.journeyClass || (!returnDate ? 'ONE_WAY' : daysBetween === 1 ? 'SAME_DAY_RETURN' : 'MULTI_DAY_RETURN');

  // 2. Distances & Distance Cost
  const totalKm = liveKm + deadKm;
  const globalFuelPrice = globals?.fuelPricePerLitre ?? 1.52;
  const fuelPrice = vehicle.fuelPricePerLitre ?? globalFuelPrice;
  const fuelPerKm = fuelPrice / (vehicle.fuelKpl || 1);
  const maintPerKm = (vehicle.maintenanceSetCost || 0) / (vehicle.expectedMaintenanceLifeKm || 1);
  const tyrePerKm = (vehicle.tyreSetCost || 0) / (vehicle.expectedTyreLifeKm || 1);
  const vehicleRate = fuelPerKm + maintPerKm + tyrePerKm;
  const distanceCost = totalKm * vehicleRate;

  // 3. Driver Cost
  const drivingHours = input.totalDurationMinutes / 60;
  const requestedWaitingHours = (Number(waitingMins) || 0) / 60;
  
  // SAME_DAY_RETURN allows waiting time, ONE_WAY/MULTI_DAY usually don't charge waiting
  // According to formula: "Waiting Hours = 1 hour (default)" -> we use requested waiting if it's there
  const waitingHours = journeyClass === 'SAME_DAY_RETURN' ? Math.max(1, requestedWaitingHours) : requestedWaitingHours;
  
  const configuredDriverWage = isHolidayDeparture ? gv.driverWageHoliday : isWeekendDeparture ? gv.driverWageWeekend : gv.driverWageWeekday;
  const driverWage = configuredNumber('driver hourly wage', [configuredDriverWage, gv.driverHourlyWage], { positive: true });
  const dualDriverThreshold = configuredNumber('two-driver threshold', [gv.dualDriverThresholdHours ?? 13], { positive: true });
  const waitingFactor = configuredNumber('waiting wage factor', [gv.waitingWageFactor ?? 0.75], { positive: true });
  
  const dualCrew = drivingHours >= dualDriverThreshold;
  const driverCount = dualCrew ? 2 : 1;
  const driverCost = ((drivingHours * driverWage) + (waitingHours * driverWage * waitingFactor)) * driverCount;

  // 4. Standing Cost
  let standingCost = 0;
  const standingCostPerDay = configuredNumber('vehicle standing cost per day', [vehicle.standingCostPerDay], { allowNegative: false });
  if (journeyClass === 'MULTI_DAY_RETURN' && daysBetween <= 2) {
    standingCost = 0; // Formula says 1-2 day returns have £0 standing cost
  } else if (journeyClass === 'MULTI_DAY_RETURN') {
    standingCost = 0; // Formula says 3+ days are treated as separate journeys, so £0 standing cost
  }

  // 5. Overnight Cost
  let overnightCost = 0;
  const overnightRate = configuredNumber('overnight cost per driver', [gv.overnightCost ?? 200], { allowNegative: false });
  if (journeyClass === 'MULTI_DAY_RETURN' && daysBetween > 2) {
    overnightCost = 0; // 3+ days = driver goes home
  } else if (journeyClass === 'MULTI_DAY_RETURN' && daysBetween <= 2) {
    overnightCost = 0; // Driver returns home
  } else if (journeyClass === 'SPLIT_RETURN' && daysBetween > 2) {
    overnightCost = 1 * overnightRate * driverCount;
  }

  // 6. Base Cost & Surcharges
  const surcharges = data.surcharges || {};
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
  if (input.usesM6Toll) {
    const cost = configuredNumber('M6 Toll surcharge', [surcharges.m6Toll]);
    surchargeTotal += cost;
    if (cost > 0) surchargeLines.push({ label: "M6 Toll (PSV)", cost });
  }

  const baseCost = distanceCost + driverCost + standingCost + overnightCost;

  // 7. Commercial Calibration
  const commercialWeight = configuredNumber('vehicle commercial weight', [vehicle.commercialWeight], { positive: true });
  const calibratedCost = baseCost * commercialWeight;

  // 8. Margin
  const configuredMargin = isHolidayDeparture ? gv.marginHoliday : isWeekendDeparture ? gv.marginWeekend : gv.marginWeekday;
  const marginPct = configuredNumber('profit margin percentage', [configuredMargin, gv.profitMarginPct]);
  const marginMultiplier = 1 + (marginPct / 100);

  let finalFare = (calibratedCost * marginMultiplier) + surchargeTotal;

  // 9. Extra Luggage
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

  // 10. Seasonal Overrides
  let seasonalMultiplier = 1;
  const depDateObj = new Date(departureDate);
  const applicableSeasons = (data.seasonalPricing || []).filter((s: any) => {
    const vehicleMatches = !Array.isArray(s.applicableVehicles) || s.applicableVehicles.length === 0 || s.applicableVehicles.includes('Any') || s.applicableVehicles.includes(vehicleId);
    const routeMatches = !Array.isArray(s.applicableRoutes) || s.applicableRoutes.length === 0 || s.applicableRoutes.includes('Any') || s.applicableRoutes.some((route: string) => {
        const normalized = String(route).toLowerCase();
        return normalized === `${originName} → ${destinationName}`.toLowerCase() || normalized === `${originName} -> ${destinationName}`.toLowerCase();
    });
    return s.enabled && new Date(s.startDate) <= depDateObj && new Date(s.endDate) >= depDateObj && vehicleMatches && routeMatches;
  }).sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0));

  if (applicableSeasons.length > 0) {
    const season = applicableSeasons[0];
    if (season.overrideFare != null) {
      finalFare = Number(season.overrideFare) + surchargeTotal;
    } else if (season.multiplier) {
      seasonalMultiplier = season.multiplier;
      finalFare = finalFare * seasonalMultiplier;
    }
  }

  // 11. Customer Range
  const roundedFinalFare = roundToNearestFive(finalFare);
  const customerRangePct = configuredNumber('customer price range percentage', [gv.customerRangePct ?? 12]);
  const upperBoundFare = roundToNearestFive(finalFare * (1 + customerRangePct / 100));

  return {
    baseFare: Math.round(baseCost),
    extraLiveMileageCharge: 0, // Not used in this model
    extraDeadMileageCharge: 0, // Not used in this model
    waitingCharge: 0,          // Baked into driver cost
    seasonalMultiplier,
    surchargeTotal: Math.round(surchargeTotal),
    surchargeLines,
    driverCost: Math.round(driverCost),
    dualCrew,
    finalFare: roundedFinalFare,
    upperBoundFare: Math.round(upperBoundFare),
    isManualQuote: true,
    pricingMethod: 'cost-model',
    breakdown: {
      distanceCost: Math.round(distanceCost * 100) / 100,
      driverCost: Math.round(driverCost * 100) / 100,
      standingCost,
      overnightCost,
      commercialWeight: Number.isFinite(commercialWeight) && commercialWeight > 0 ? commercialWeight : 1,
      marginPct,
      driverRate: driverWage,
      waitingHours,
      surchargeTotal: Math.round(surchargeTotal * 100) / 100,
      customerRangePct
    }
  };
}
