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
  const data = db.data;
  if (!data) return false;

  const vehicle = data.vehicles?.find((v: any) => v.id === input.vehicleId);
  if (!vehicle) return false;

  const requiredVehicles = Math.max(1, Math.ceil((input.passengers || 1) / Math.max(1, vehicle.capacity)));
  if (vehicle.fleetCount != null && requiredVehicles > Number(vehicle.fleetCount)) return false;

  const depDate = new Date(input.departureDate);
  const retDate = input.returnDate ? new Date(input.returnDate) : depDate;

  const availabilityBlocks = [
    ...(data.vehicleAvailability || []),
    ...(data.blockedDates || [])
  ];
  const overlappingBlocks = availabilityBlocks.filter(block => {
    if (block.vehicleId !== vehicle.id) return false;
    const blockStart = new Date(block.from);
    const blockEnd = new Date(block.to);

    return depDate <= blockEnd && retDate >= blockStart;
  });

  // A block can optionally represent one unavailable unit. Preserve the
  // vehicle type while enough units remain for the requested party.
  const unavailableUnits = overlappingBlocks.reduce(
    (sum, block: any) => sum + Math.max(1, Number(block.units) || 1),
    0
  );
  const fleetCount = Math.max(1, Number(vehicle.fleetCount) || 1);
  if (requiredVehicles > fleetCount - unavailableUnits) return false;

  return true;
}
