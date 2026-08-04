import { getDatabase } from '../database/db';

interface AvailabilityInput {
  vehicleId: string;
  passengers: number;
  departureDate: string;
  returnDate?: string;
  suitcaseCount?: number;
  handbagCount?: number;
}

export async function checkAvailability(input: AvailabilityInput, env: any) {
  const db = await getDatabase(env);
  return checkAvailabilityFromData(input, db.data);
}

/**
 * Pure availability calculation used by both the API flow and the regression
 * test suite. Keeping the business decision separate from persistence makes
 * capacity and date-overlap behavior deterministic and independently testable.
 */
export function checkAvailabilityFromData(input: AvailabilityInput, data: any) {
  if (!data) return false;

  const vehicle = data.vehicles?.find((v: any) => v.id === input.vehicleId);
  if (!vehicle) return false;

  const passengers = Number(input.passengers);
  const capacity = Number(vehicle.capacity);
  const fleetCount = Number(vehicle.fleetCount);
  if (!Number.isInteger(passengers) || passengers < 1 ||
      !Number.isInteger(capacity) || capacity < 1 ||
      !Number.isInteger(fleetCount) || fleetCount < 1) return false;
  const requiredVehicles = Math.ceil(passengers / capacity);
  if (requiredVehicles > fleetCount) return false;

  const depDate = new Date(input.departureDate);
  const retDate = input.returnDate ? new Date(input.returnDate) : depDate;
  if (Number.isNaN(depDate.getTime()) || Number.isNaN(retDate.getTime()) || retDate < depDate) {
    return false;
  }

  const availabilityBlocks = [
    ...(data.vehicleAvailability || []),
    ...(data.blockedDates || [])
  ];
  const hasInvalidRelevantBlock = availabilityBlocks.some((block: any) => {
    if (block.vehicleId !== vehicle.id) return false;
    const blockStart = new Date(block.from);
    const blockEnd = new Date(block.to);
    const units = Number(block.units);
    return Number.isNaN(blockStart.getTime()) || Number.isNaN(blockEnd.getTime()) ||
      blockEnd < blockStart || !Number.isInteger(units) || units < 1;
  });
  if (hasInvalidRelevantBlock) return false;
  const overlappingBlocks = availabilityBlocks.filter(block => {
    if (block.vehicleId !== vehicle.id) return false;
    const blockStart = new Date(block.from);
    const blockEnd = new Date(block.to);

    return depDate <= blockEnd && retDate >= blockStart;
  });

  const unavailableUnits = overlappingBlocks.reduce((sum, block: any) => sum + Number(block.units), 0);
  if (requiredVehicles > fleetCount - unavailableUnits) return false;

  return true;
}
