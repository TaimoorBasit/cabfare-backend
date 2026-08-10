import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = process.argv[2] || '.data/db.json';
const destinationPath = process.argv[3] || sourcePath;
const data = JSON.parse(await readFile(sourcePath === '-' ? 0 : sourcePath, 'utf8'));

const vehiclePolicies: Record<string, { ratePerKm: number; commercialWeight: number; standingCostPerDay: number }> = {
  minibus: { ratePerKm: 1.2, commercialWeight: 1, standingCostPerDay: 150 },
  bus: { ratePerKm: 1.65, commercialWeight: 1.08, standingCostPerDay: 200 },
  coach: { ratePerKm: 2.6, commercialWeight: 1.12, standingCostPerDay: 260 }
};

data.vehicles = (data.vehicles || []).map((vehicle: any) => ({
  ...vehicle,
  ...(vehiclePolicies[vehicle.id] || {})
}));

data.globalVars = {
  ...(data.globalVars || {}),
  pricingModelVersion: 'supervisor-2025-12',
  driverWageWeekday: 15,
  driverWageWeekend: 20,
  driverWageHoliday: 22,
  marginWeekday: 20,
  marginWeekend: 25,
  marginHoliday: 30,
  overnightCost: 200,
  emptyLegThresholdKm: 20,
  dualDriverThresholdHours: 9,
  waitingWageFactor: 0.75,
  customerRangePct: 12,
  yardAddress: 'Unit 1, Carolean Coaches, Bentley Lane, Walsall WS2 8TL, UK',
  yardLat: 52.5842,
  yardLng: -1.9873
};

// Preserve historical rules for reference, but prevent the old global mileage
// matrix from silently bypassing the documented cost model.
data.pricingMatrix = (data.pricingMatrix || []).map((rule: any) => ({ ...rule, status: 'inactive' }));

await writeFile(destinationPath, JSON.stringify(data, null, 2), 'utf8');
console.log(JSON.stringify({
  vehiclesUpdated: data.vehicles.length,
  matricesDisabled: data.pricingMatrix.length,
  pricingModelVersion: data.globalVars.pricingModelVersion
}));
