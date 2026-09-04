import { calculateMileage } from './mileageEngine';
import { calculatePrice } from './pricingEngine';
import { checkAvailability } from './availabilityEngine';
import { getDatabase } from '../database/db';

export class QuoteValidationError extends Error {}

export function calculateTotalWaitingMinutes(journey: any) {
  const journeyWaitingMinutes = Math.max(0, Number(journey?.waitingMins) || 0);
  const stopWaitingMinutes = (Array.isArray(journey?.stops) ? journey.stops : [])
    .reduce((sum: number, stop: any) => sum + Math.max(0, Number(stop?.wait) || 0), 0);
  return journeyWaitingMinutes + stopWaitingMinutes;
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

export async function generateQuotes(journey: any, env: any) {
  const db = await getDatabase(env);
  const data = db.data;
  if (!data || !data.vehicles) throw new Error("Database missing vehicles");

  if (!journey?.origin || !journey?.destination) {
    throw new QuoteValidationError("Pickup and destination are required");
  }
  if (!['one-way', 'return'].includes(journey.journeyType)) {
    throw new QuoteValidationError("Journey type must be one-way or return");
  }
  const passengers = Number(journey.passengers);
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > 500) {
    throw new QuoteValidationError("Passengers must be a whole number between 1 and 500");
  }
  const departure = new Date(journey.departureDate);
  if (Number.isNaN(departure.getTime())) {
    throw new QuoteValidationError("A valid departure date is required");
  }
  if (journey.journeyType === 'return') {
    const returnDate = new Date(journey.returnDate);
    if (Number.isNaN(returnDate.getTime()) || returnDate <= departure) {
      throw new QuoteValidationError("Return date must be after the departure date");
    }
  }

  const quotes = [];

  const availableVehicles = (await Promise.all((data.vehicles as any[]).map(async vehicle => ({
    vehicle,
    available: await checkAvailability({
      vehicleId: vehicle.id,
      passengers: journey.passengers,
      departureDate: journey.departureDate,
      returnDate: journey.returnDate,
      suitcaseCount: journey.suitcaseCount,
      handbagCount: journey.handbagCount
    }, env)
  })))).filter(item => item.available);

  for (const { vehicle } of availableVehicles) {

    const mileageResult = await calculateMileage({
      ...journey,
      emptyLegThresholdKm: Number(vehicle.pricingSettings?.emptyLegThresholdKm ?? 20)
    }, env);
    const usesM6Toll = (mileageResult.legs || []).some((leg: any) =>
      (leg.steps || []).some((step: any) => /m6\s*toll/i.test(String(step.html_instructions || '')))
    );
    const totalWaitingMinutes = (Number(mileageResult.automaticWaitingMinutes) || 0) + calculateTotalWaitingMinutes(journey);

    const usableCapacity = /premium coach/i.test(String(vehicle.name || '')) ? 50 : (vehicle.capacity || 1);
    const requiredVehicles = Math.max(1, Math.ceil(passengers / usableCapacity));
    const paxPerVehicle = Math.ceil(passengers / requiredVehicles);
    const suitcasesPerVehicle = Math.ceil((journey.suitcaseCount || 0) / requiredVehicles);
    const handbagsPerVehicle = Math.ceil((journey.handbagCount || 0) / requiredVehicles);

    const pricingResult = await calculatePrice({
      liveKm: mileageResult.liveKm,
      deadKm: mileageResult.deadKm,
      liveDurationMinutes: mileageResult.liveDurationMinutes,
      totalDurationMinutes: mileageResult.totalDurationMinutes,
      vehicleId: vehicle.id,
      journeyType: journey.journeyType,
      passengers: paxPerVehicle,
      suitcaseCount: suitcasesPerVehicle,
      handbagCount: handbagsPerVehicle,
      originName: String(journey.origin),
      destinationName: String(journey.destination),
      originCoords: journey.wpCoords?.[0] || null,
      destinationCoords: journey.wpCoords?.[journey.wpCoords?.length - 1] || null,
      waypoints: mileageResult.geometry ? [] : [], 
      waitingMins: totalWaitingMinutes,
      departureDate: journey.departureDate,
      returnDate: journey.returnDate,
      journeyClass: mileageResult.journeyClass,
      usesM6Toll
    }, env);

    

    quotes.push({
      vehicle: usableCapacity === vehicle.capacity ? vehicle : { ...vehicle, capacity: usableCapacity },
      result: {
        distanceUnit: data.globalVars?.distanceUnit,
        totalKm: Math.round(data.globalVars?.distanceUnit === 'miles' ? mileageResult.totalKm / 1.60934 : mileageResult.totalKm),
        revenueKm: Math.round(data.globalVars?.distanceUnit === 'miles' ? mileageResult.liveKm / 1.60934 : mileageResult.liveKm),
        chargedKm: Math.round(mileageResult.totalKm),
        customerKm: Math.round(mileageResult.liveKm),
        deadKm: Math.round(data.globalVars?.distanceUnit === 'miles' ? mileageResult.deadKm / 1.60934 : mileageResult.deadKm),
        journeyClass: mileageResult.journeyClass,
        emptyLegApplied: mileageResult.emptyLegApplied,
        vehicleCount: requiredVehicles,
        totalSeatCapacity: usableCapacity * requiredVehicles,
        finalPrice: pricingResult.finalFare * requiredVehicles,
        vatPct: Number(data.globalVars?.vatPct ?? 20),
        vatAmount: pricingResult.finalFare * requiredVehicles * Number(data.globalVars?.vatPct ?? 20) / 100,
        customerTotal: pricingResult.finalFare * requiredVehicles * (1 + Number(data.globalVars?.vatPct ?? 20) / 100),
        upperBoundPrice: Math.max(pricingResult.finalFare, pricingResult.upperBoundFare || pricingResult.finalFare) * requiredVehicles,
        subtotal: (pricingResult.baseFare + pricingResult.extraLiveMileageCharge + pricingResult.extraDeadMileageCharge + pricingResult.waitingCharge) * requiredVehicles,
        surchargeLines: pricingResult.surchargeLines.map(s => ({...s, cost: s.cost * requiredVehicles})),
        surchargeTotal: pricingResult.surchargeTotal * requiredVehicles,
        driverCost: pricingResult.driverCost * requiredVehicles,
        dualCrew: pricingResult.dualCrew,
        chain: mileageResult.legs, 
        geometry: mileageResult.geometry,
        pts: Array.isArray(journey.wpCoords) ? journey.wpCoords : [],
        isManualQuote: pricingResult.isManualQuote,
        belowMin: false, 
        opDays: calculateOperatingDays(journey.departureDate, journey.returnDate),
        totalShiftHrs: Math.round(((mileageResult.totalDurationMinutes + totalWaitingMinutes) / 60) * 10) / 10
        ,pricingMethod: pricingResult.pricingMethod
        ,breakdown: pricingResult.breakdown
      }
    });
  }

  return quotes;
}
