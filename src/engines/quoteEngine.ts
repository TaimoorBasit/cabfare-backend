import { calculateMileage } from './mileageEngine';
import { calculatePrice } from './pricingEngine';
import { checkAvailability } from './availabilityEngine';
import { getDatabase } from '../database/db';

export async function generateQuotes(journey: any, env: any) {
  const db = await getDatabase(env);
  const data = db.data;
  if (!data || !data.vehicles) throw new Error("Database missing vehicles");

  const mileageResult = await calculateMileage(journey, env);

  const quotes = [];

  for (const vehicle of data.vehicles as any[]) {

    const isAvailable = await checkAvailability({
      vehicleId: vehicle.id,
      passengers: journey.passengers,
      departureDate: journey.departureDate,
      returnDate: journey.returnDate,
      suitcaseCount: journey.suitcaseCount,
      handbagCount: journey.handbagCount
    }, env);

    const usableCapacity = vehicle.capacity || 1;
    const requiredVehicles = Math.max(1, Math.ceil((journey.passengers || 1) / usableCapacity));
    const paxPerVehicle = Math.ceil((journey.passengers || 0) / requiredVehicles);
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
      waitingMins: journey.waitingMins,
      departureDate: journey.departureDate,
      returnDate: journey.returnDate
    }, env);

    // requiredVehicles already calculated above

    quotes.push({
      vehicle,
      result: {
        totalKm: Math.round(mileageResult.totalKm),
        revenueKm: Math.round(mileageResult.liveKm),
        finalPrice: pricingResult.finalFare * requiredVehicles,
        subtotal: (pricingResult.baseFare + pricingResult.extraLiveMileageCharge + pricingResult.extraDeadMileageCharge + pricingResult.waitingCharge) * requiredVehicles,
        surchargeLines: pricingResult.surchargeLines.map(s => ({...s, cost: s.cost * requiredVehicles})),
        surchargeTotal: pricingResult.surchargeTotal * requiredVehicles,
        chain: mileageResult.legs, 
        geometry: mileageResult.geometry,
        pts: [journey.wpCoords?.[0] || {lat:0, lng:0}, journey.wpCoords?.[1] || {lat:0, lng:0}], 
        isManualQuote: pricingResult.isManualQuote,
        belowMin: false, 
        opDays: (journey.returnDate && journey.departureDate && new Date(journey.returnDate) > new Date(journey.departureDate)) ? Math.max(1, Math.ceil((new Date(journey.returnDate).getTime() - new Date(journey.departureDate).getTime()) / 86400000) + 1) : 1,
        totalShiftHrs: Math.round(((mileageResult.totalDurationMinutes + Number(journey.waitingMins || 0)) / 60) * 10) / 10
      }
    });
  }

  return quotes;
}
