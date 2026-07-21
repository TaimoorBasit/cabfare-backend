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

export function fleetEconomics(dbData: any) {
  const companyOverheads = dbData.annualOverheads?.reduce((s: number, o: any) => s + Number(o.cost), 0) || 0;
  const totalFleetUnits = dbData.vehicles?.reduce((s: number, v: any) => s + (Number(v.fleetCount)||1), 0) || 1;
  const overheadPerUnit = totalFleetUnits > 0 ? companyOverheads / totalFleetUnits : 0;

  const vehicleBreakdown = dbData.vehicles?.map((v: any) => {
    const count = Number(v.fleetCount) || 1;
    const utilDays = Number(v.utilisationDays) || 225;
    const totalAnnualFixed = (v.annualCosts || []).reduce((s: number, c: any) => s + Number(c.cost), 0);
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

  // 1. Check Route Templates (Radius Match or Exact Match)
  const template = data.routeTemplates.find(t => 
    t.vehicleId === vehicleId && 
    t.tripType === journeyType &&
    matchLocation(originCoords, originName, t.pickupGeo, t.pickupArea, t.radiusKm ?? 15) &&
    matchLocation(destinationCoords, destinationName, t.dropGeo, t.dropArea, t.radiusKm ?? 15)
  );

  let baseFare = 0;
  let waitingCharge = 0;
  let extraLiveMileageCharge = 0;
  let extraDeadMileageCharge = 0;
  let isManualQuote = false;
  let preSurchargeBase = 0;

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
    } else {

      isManualQuote = true;

      const totalKm = liveKm + deadKm;
      const gv = data.globalVars || {};
      const drivHrs = input.totalDurationMinutes / 60; 
      const waitHrs = (Number(waitingMins) || 0) / 60;
      const shiftHrs = drivHrs + waitHrs;
      const dualCrew = shiftHrs > 9;

      let opDays = 1;
      if (returnDate && departureDate && new Date(returnDate) > new Date(departureDate)) {
        opDays = Math.max(1, Math.ceil((new Date(returnDate).getTime() - new Date(departureDate).getTime()) / 86400000) + 1);
      }

      const totalAnnualFixed = (vehicle.annualCosts || []).reduce((s: number, c: any) => s + Number(c.cost), 0);
      const fleetCount = vehicle.fleetCount || 1;
      const annualFixed = totalAnnualFixed / fleetCount;
      const rStanding = annualFixed / (vehicle.utilisationDays || 225);

      const fuelPrice = vehicle.fuelPricePerLitre ?? gv.fuelPricePerLitre ?? 1.52;
      const fuelPerKm = fuelPrice / (vehicle.fuelKpl || 5);
      const tyrePerKm = vehicle.tyreCostPerKm ?? 0.05;
      const maintPerKm = vehicle.maintenanceCostPerKm || 0.15;
      const cRunning = fuelPerKm + tyrePerKm + maintPerKm;

      const driverWage = vehicle.driverHourlyWage ?? gv.driverHourlyWage ?? 17.50;
      const holPayPct = vehicle.holidayPayPct ?? gv.holidayPayPct ?? 12.07;
      const baseWage = driverWage * shiftHrs * opDays;
      const holPay = baseWage * (holPayPct / 100);
      const driverCost = (baseWage + holPay) * (dualCrew ? 2 : 1);

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
    surchargeTotal += surcharges.ulez || 12.5;
    surchargeLines.push({ label: "London ULEZ / CAZ", cost: surcharges.ulez || 12.5 });
  }
  if (goesBirm) {
    surchargeTotal += surcharges.birminghamCaz || 9;
    surchargeLines.push({ label: "Birmingham CAZ", cost: surcharges.birminghamCaz || 9 });
  }
  if (goesDartford) {
    surchargeTotal += surcharges.dartford || 2.5;
    surchargeLines.push({ label: "Dartford Crossing", cost: surcharges.dartford || 2.5 });
  }

  let opDays = 1;
  if (returnDate && departureDate && new Date(returnDate) > new Date(departureDate)) {
    opDays = Math.max(1, Math.ceil((new Date(returnDate).getTime() - new Date(departureDate).getTime()) / 86400000) + 1);
  }
  if (opDays > 1) {
    const sub = (surcharges.driverOvernightSubsistence || 55) * (opDays - 1);
    surchargeTotal += sub;
    surchargeLines.push({ label: `Driver subsistence ×${opDays-1}`, cost: sub });
  }

  let finalFare = preSurchargeBase + surchargeTotal;
  const gv = data.globalVars || {};

  if (isManualQuote) {

    const vehicleProfitPct = vehicle?.profitMarginPct ?? gv.profitMarginPct ?? 28;
    const profitMargin = vehicleProfitPct / 100;
    finalFare = finalFare * (1 + profitMargin);

    const eco = fleetEconomics(data);
    const vEco = eco.vehicleBreakdown.find((b: any) => b.id === vehicleId);
    let opDays = 1;
    if (returnDate && departureDate && new Date(returnDate) > new Date(departureDate)) {
      opDays = Math.max(1, Math.ceil((new Date(returnDate).getTime() - new Date(departureDate).getTime()) / 86400000) + 1);
    }
    const minHire = (vEco ? vEco.minHirePerDay : 0) * opDays;

    if (finalFare < minHire) {
      finalFare = minHire;
    }
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

  const applicableSeasons = (data.seasonalPricing || []).filter((s: any) => 
    s.enabled && 
    new Date(s.startDate) <= depDateObj && 
    new Date(s.endDate) >= depDateObj &&
    (!Array.isArray(s.applicableVehicles) || s.applicableVehicles.includes('Any') || s.applicableVehicles.includes(vehicleId))
  ).sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0));

  if (applicableSeasons.length > 0) {
    const season = applicableSeasons[0];
    if (season.overrideFare) {
      finalFare = season.overrideFare;
      extraLiveMileageCharge = 0;
      extraDeadMileageCharge = 0;
    } else if (season.multiplier) {
      seasonalMultiplier = season.multiplier;
      finalFare = finalFare * seasonalMultiplier;
    }
  }

  return {
    baseFare: Math.round(baseFare),
    extraLiveMileageCharge: Math.round(extraLiveMileageCharge),
    extraDeadMileageCharge: Math.round(extraDeadMileageCharge),
    waitingCharge: Math.round(waitingCharge),
    seasonalMultiplier,
    surchargeTotal: Math.round(surchargeTotal),
    surchargeLines,
    finalFare: Math.round(finalFare),
    isManualQuote
  };
}
