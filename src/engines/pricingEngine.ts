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

  const checkRadius = radiusKm > 0 ? radiusKm : 10;
  if (ruleGeo && ruleGeo.lat && coord && coord.lat) {
    if (haversineKm(coord, ruleGeo) <= checkRadius) {
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
  return costs.reduce(
    (sum: number, cost: any) => sum + Number(cost.amount ?? cost.cost ?? 0),
    0
  );
}

export function fleetEconomics(dbData: any) {
  const companyOverheads = dbData.annualOverheads?.reduce((s: number, o: any) => s + Number(o.cost), 0) || 0;
  const totalFleetUnits = dbData.vehicles?.reduce((s: number, v: any) => s + (Number(v.fleetCount)||1), 0) || 1;
  const overheadPerUnit = totalFleetUnits > 0 ? companyOverheads / totalFleetUnits : 0;

  const vehicleBreakdown = dbData.vehicles?.map((v: any) => {
    const count = Number(v.fleetCount) || 1;
    const utilDays = Number(v.utilisationDays) || 225;
    const totalAnnualFixed = getAnnualFixedCost(v);
    const annualFixed = totalAnnualFixed / count;
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
  const data = db.data;
  if (!data || !data.vehicles) throw new Error("Database not initialized");

  const {
    liveKm, deadKm, vehicleId, journeyType, originName, destinationName, originCoords, destinationCoords, waitingMins, departureDate, returnDate
  } = input;

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
  const templateRadiusFactor = data.globalVars?.distanceUnit === 'miles' ? 1.60934 : 1;
  const template = data.routeTemplates.find(t => 
    t.vehicleId === vehicleId && 
    t.tripType === journeyType &&
    matchLocation(originCoords, originName, t.pickupGeo, t.pickupArea, (t.radiusKm ?? 15) * templateRadiusFactor) &&
    matchLocation(destinationCoords, destinationName, t.dropGeo, t.dropArea, (t.radiusKm ?? 15) * templateRadiusFactor)
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
    baseFare = template.price;
    waitingCharge = (waitingMins / 60) * 20; // Default £20/hr
    preSurchargeBase = baseFare + waitingCharge;
  } else {
    // 2. Check Pricing Matrix
    const matrix = data.pricingMatrix.find(m => 
      m.vehicleId === vehicleId &&
      m.status === 'active' &&
      (m.tripType === journeyType || m.tripType === 'any') &&
      matchLocation(originCoords, originName, m.pickupGeo, m.pickupArea, 0) &&
      matchLocation(destinationCoords, destinationName, m.dropGeo, m.dropArea, 0)
    );

    if (matrix) {
      baseFare = matrix.baseFare;
      const extraLive = Math.max(0, liveKm - matrix.includedLiveMileage);
      extraLiveMileageCharge = extraLive * matrix.extraMileageRate;

      const extraDead = Math.max(0, deadKm - matrix.includedDeadMileage);
      extraDeadMileageCharge = extraDead * matrix.extraMileageRate; 

      waitingCharge = (waitingMins / 60) * matrix.waitingChargePerHour;
      preSurchargeBase = baseFare + extraLiveMileageCharge + extraDeadMileageCharge + waitingCharge;

      const departure = new Date(departureDate);
      if (!Number.isNaN(departure.getTime())) {
        const isWeekend = departure.getDay() === 0 || departure.getDay() === 6;
        const hour = departure.getHours();
        const isNight = hour < 6 || hour >= 22;
        if (isWeekend) preSurchargeBase *= Number(matrix.weekendRateMultiplier) || 1;
        if (isNight) preSurchargeBase *= Number(matrix.nightRateMultiplier) || 1;
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
      const fleetCount = vehicle.fleetCount || 1;
      const annualFixed = totalAnnualFixed / fleetCount;
      const calculatedStanding = annualFixed / (vehicle.utilisationDays || 225);
      const rStanding = totalAnnualFixed > 0
        ? calculatedStanding
        : Number(vehicle.standingCostPerDay) || 0;

      const fuelPrice = vehicle.fuelPricePerLitre ?? gv.fuelPricePerLitre ?? 1.52;
      const fuelPerKm = fuelPrice / (vehicle.fuelKpl || 5);
      const calculatedTyrePerKm =
        Number(vehicle.tyreSetCost) > 0 && Number(vehicle.expectedTyreLifeKm) > 0
          ? Number(vehicle.tyreSetCost) / Number(vehicle.expectedTyreLifeKm)
          : 0.05;
      const tyrePerKm = vehicle.tyreCostPerKm ?? calculatedTyrePerKm;
      const maintPerKm = vehicle.maintenanceCostPerKm ?? 0.15;
      const hasDetailedRunningCosts =
        vehicle.fuelKpl != null ||
        vehicle.tyreCostPerKm != null ||
        vehicle.maintenanceCostPerKm != null;
      const cRunning = !hasDetailedRunningCosts && Number(vehicle.ratePerKm) > 0
        ? Number(vehicle.ratePerKm)
        : fuelPerKm + tyrePerKm + maintPerKm;

      const configuredDriverWage = isHolidayDeparture
        ? gv.driverWageHoliday
        : isWeekendDeparture
          ? gv.driverWageWeekend
          : gv.driverWageWeekday;
      const driverWage = vehicle.driverHourlyWage ?? configuredDriverWage ?? gv.driverHourlyWage ?? 17.50;
      const holPayPct = vehicle.holidayPayPct ?? gv.holidayPayPct ?? 12.07;
      // The route duration already covers the full outbound/return journey.
      // Only standing costs are charged per operating day.
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
    const cost = surcharges.ulez ?? 12.5;
    surchargeTotal += cost;
    if (cost > 0) surchargeLines.push({ label: "London ULEZ / CAZ", cost });
  }
  if (goesBirm) {
    const cost = surcharges.birminghamCaz ?? 9;
    surchargeTotal += cost;
    if (cost > 0) surchargeLines.push({ label: "Birmingham CAZ", cost });
  }
  if (goesDartford) {
    const cost = surcharges.dartford ?? 2.5;
    surchargeTotal += cost;
    if (cost > 0) surchargeLines.push({ label: "Dartford Crossing", cost });
  }
  if (input.usesM6Toll) {
    const cost = surcharges.m6Toll ?? 6.5;
    surchargeTotal += cost;
    if (cost > 0) surchargeLines.push({ label: "M6 Toll (PSV)", cost });
  }

  const opDays = calculateOperatingDays(departureDate, returnDate);
  if (opDays > 1) {
    const sub = (surcharges.driverOvernightSubsistence ?? 55) * (opDays - 1);
    surchargeTotal += sub;
    if (sub > 0) surchargeLines.push({ label: `Driver subsistence ×${opDays-1}`, cost: sub });
    const accommodationPerDriver = data.globalVars?.overnightCost ?? 0;
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
    const vehicleProfitPct = vehicle?.profitMarginPct ?? configuredMargin ?? gv.profitMarginPct ?? 28;
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
  const cap = vehicle.capacity || 16;

  const extraSuitcases = Math.max(0, suitcaseCount - cap);
  const extraHandbags = Math.max(0, handbagCount - cap);
  const totalExtraBags = extraSuitcases + extraHandbags;

  if (totalExtraBags > 0) {
    const extraLuggagePct = vehicle?.extraLuggageProfitPct ?? gv.extraLuggageProfitPct ?? 0.2;
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

    let upperBoundFare = finalFare;
    if (isManualQuote) {
        const roundedLower = Math.round(finalFare / 5) * 5;
        const roundedUpper = Math.round((finalFare * 1.12) / 5) * 5;
        finalFare = roundedLower;
        upperBoundFare = roundedUpper;
    }

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
