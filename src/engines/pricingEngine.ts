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

  // 1. Check Route Templates (Radius Match or Exact Match)
  const distanceUnit = data.globalVars?.distanceUnit;
  if (distanceUnit !== 'km' && distanceUnit !== 'miles') {
    throw new PricingConfigurationError('distance unit must be configured as km or miles');
  }
  const templateRadiusFactor = distanceUnit === 'miles' ? 1.60934 : 1;
  const template = (Array.isArray(data.routeTemplates) ? data.routeTemplates : []).find((t: RouteTemplate) => 
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
    const matrix = [...matrixRules]
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
      const totalDistance = Number(liveKm) + Number(deadKm);
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
      const mileageRate = configuredNumber('pricing matrix distance-band rate', [configuredBand.rate]);
      const includedLiveMileage = configuredNumber('included live mileage', [matrix.includedLiveMileage]);
      const includedDeadMileage = configuredNumber('included dead mileage', [matrix.includedDeadMileage]);
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

      const totalKm = liveKm + deadKm;
      const gv = data.globalVars || {};
      const drivHrs = input.totalDurationMinutes / 60; 
      const waitHrs = (Number(waitingMins) || 0) / 60;
      const shiftHrs = drivHrs + waitHrs;

      const opDays = calculateOperatingDays(departureDate, returnDate);

      const totalAnnualFixed = getAnnualFixedCost(vehicle);
      const fleetCount = configuredNumber('vehicle fleet count', [vehicle.fleetCount], { positive: true });
      const annualFixed = totalAnnualFixed / fleetCount;
      const utilisationDays = configuredNumber('vehicle utilisation days', [vehicle.utilisationDays], { positive: true });
      const calculatedStanding = annualFixed / utilisationDays;
      const rStanding = totalAnnualFixed > 0
        ? calculatedStanding
        : configuredNumber('vehicle standing cost per day', [vehicle.standingCostPerDay]);

      const fuelPrice = configuredNumber('fuel price per litre', [vehicle.fuelPricePerLitre, gv.fuelPricePerLitre], { positive: true });
      const fuelKpl = configuredNumber('vehicle fuel consumption', [vehicle.fuelKpl], { positive: true });
      const fuelPerKm = fuelPrice / fuelKpl;
      const directTyreCost = Number(vehicle.tyreCostPerKm);
      const tyreSetCost = Number(vehicle.tyreSetCost);
      const tyreLife = Number(vehicle.expectedTyreLifeKm);
      const tyrePerKm = Number.isFinite(directTyreCost) && directTyreCost > 0
        ? directTyreCost
        : tyreSetCost > 0 && tyreLife > 0
          ? tyreSetCost / tyreLife
          : Number.isFinite(directTyreCost) && directTyreCost >= 0
            ? directTyreCost
            : (() => { throw new PricingConfigurationError('vehicle tyre cost is missing or invalid'); })();
      const maintPerKm = configuredNumber('vehicle maintenance cost per distance unit', [vehicle.maintenanceCostPerKm]);
      const cRunning = fuelPerKm + tyrePerKm + maintPerKm;

      const configuredDriverWage = isHolidayDeparture
        ? gv.driverWageHoliday
        : isWeekendDeparture
          ? gv.driverWageWeekend
          : gv.driverWageWeekday;
      const driverWage = configuredNumber('driver hourly wage', [vehicle.driverHourlyWage, configuredDriverWage, gv.driverHourlyWage], { positive: true });
      const holPayPct = configuredNumber('holiday pay percentage', [vehicle.holidayPayPct, gv.holidayPayPct]);
      
      
      const averageDailyShiftHrs = shiftHrs / opDays;
      dualCrew = averageDailyShiftHrs > 9;
      const baseWage = driverWage * shiftHrs;
      const holPay = baseWage * (holPayPct / 100);
      driverCost = (baseWage + holPay) * (dualCrew ? 2 : 1);

      const rawSubtotal = (rStanding * opDays) + (cRunning * totalKm) + driverCost;

      baseFare = rawSubtotal;
      preSurchargeBase = baseFare;
    }
  }

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


  const opDays = calculateOperatingDays(departureDate, returnDate);
  if (opDays > 1) {
    const subsistenceRate = configuredNumber('driver overnight subsistence', [surcharges.driverOvernightSubsistence]);
    const sub = subsistenceRate * (opDays - 1);
    surchargeTotal += sub;
    if (sub > 0) surchargeLines.push({ label: `Driver subsistence ×${opDays-1}`, cost: sub });
    const accommodationPerDriver = configuredNumber('driver overnight accommodation', [data.globalVars?.overnightCost]);
    const accommodation = accommodationPerDriver * (opDays - 1) * (dualCrew ? 2 : 1);
    surchargeTotal += accommodation;
    if (accommodation > 0) {
      surchargeLines.push({ label: `Driver overnight accommodation ×${opDays - 1}`, cost: accommodation });
    }
  }

  let finalFare = preSurchargeBase + surchargeTotal;
  const gv = data.globalVars || {};

  if (isManualQuote) {

    const configuredMargin = isHolidayDeparture
      ? gv.marginHoliday
      : isWeekendDeparture
        ? gv.marginWeekend
        : gv.marginWeekday;
    const vehicleProfitPct = configuredNumber('profit margin percentage', [vehicle?.profitMarginPct, configuredMargin, gv.profitMarginPct]);
    const profitMargin = vehicleProfitPct / 100;
    finalFare = finalFare * (1 + profitMargin);

    const eco = fleetEconomics(data);
    const vEco = eco.vehicleBreakdown.find((b: any) => b.id === vehicleId);
    const minHire = (vEco ? vEco.minHirePerDay : 0) * opDays;

    if (finalFare < minHire) {
      finalFare = minHire;
    }
  }

  const commercialWeight = Number(vehicle.commercialWeight);
  if (Number.isFinite(commercialWeight) && commercialWeight > 0) {
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

    // Do not invent an estimate range or hidden rounding uplift. The configured
    // calculation is the price returned to the customer.
    const upperBoundFare = finalFare;

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
      finalFare: Math.round(finalFare),
      upperBoundFare: Math.round(upperBoundFare),
      isManualQuote
    };
}
