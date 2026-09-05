import { calculateMileage } from './mileageEngine';
import { calculatePrice } from './pricingEngine';
import { checkAvailability } from './availabilityEngine';
import { getDatabase } from '../database/db';
import { MILES_TO_KM } from '../utils/units';

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
  if (!Number.isInteger(passengers) || passengers < 1) {
    throw new QuoteValidationError("Passengers must be a whole number of at least 1");
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

  const requestedVehicles = journey.vehiclePreference
    ? (data.vehicles as any[]).filter(vehicle => {
        const preference = String(journey.vehiclePreference).toLowerCase();
        const id = String(vehicle.id || '').toLowerCase();
        const name = String(vehicle.name || '').toLowerCase();
        return id === preference || name === preference || name.includes(preference);
      })
    : data.vehicles as any[];
  const availableVehicles = (await Promise.all(requestedVehicles.map(async vehicle => ({
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

  const generatedQuotes = await Promise.all(availableVehicles.map(async ({ vehicle }) => {

    const mileageResult = await calculateMileage({
      ...journey,
      emptyLegThresholdKm: Number(vehicle.pricingSettings?.emptyLegThresholdKm)
    }, env);
    const totalWaitingMinutes = (Number(mileageResult.automaticWaitingMinutes) || 0) + calculateTotalWaitingMinutes(journey);

    const usableCapacity = Number(vehicle.capacity);
    if (!Number.isFinite(usableCapacity) || usableCapacity < 1) throw new QuoteValidationError(`Vehicle ${vehicle.name || vehicle.id} capacity is missing or invalid`);
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
    }, env);

    

    return {
      vehicle: usableCapacity === vehicle.capacity ? vehicle : { ...vehicle, capacity: usableCapacity },
      result: {
        distanceUnit: data.globalVars?.distanceUnit,
        totalKm: Math.round(data.globalVars?.distanceUnit === 'miles' ? mileageResult.totalKm / MILES_TO_KM : mileageResult.totalKm),
        revenueKm: Math.round(data.globalVars?.distanceUnit === 'miles' ? mileageResult.liveKm / MILES_TO_KM : mileageResult.liveKm),
        chargedKm: Math.round(mileageResult.totalKm),
        customerKm: Math.round(mileageResult.liveKm),
        deadKm: Math.round(data.globalVars?.distanceUnit === 'miles' ? mileageResult.deadKm / MILES_TO_KM : mileageResult.deadKm),
        journeyClass: mileageResult.journeyClass,
        emptyLegApplied: mileageResult.emptyLegApplied,
        vehicleCount: requiredVehicles,
        totalSeatCapacity: usableCapacity * requiredVehicles,
        finalPrice: pricingResult.finalFare * requiredVehicles,
        vatPct: Number(data.globalVars?.vatPct),
        vatAmount: pricingResult.finalFare * requiredVehicles * Number(data.globalVars?.vatPct) / 100,
        customerTotal: pricingResult.finalFare * requiredVehicles * (1 + Number(data.globalVars?.vatPct) / 100),
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
    };
  }));

  return generatedQuotes;
}
