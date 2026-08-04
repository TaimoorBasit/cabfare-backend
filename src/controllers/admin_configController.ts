type Request = any; type Response = any; type NextFunction = any;
import { addActivity, getDatabase } from '../database/db';

const numericGlobalFields = [
  'driverWageWeekday', 'driverWageWeekend', 'driverWageHoliday',
  'marginWeekday', 'marginWeekend', 'marginHoliday', 'overnightCost',
  'waitingChargePerHour', 'yardLat', 'yardLng', 'fuelPricePerLitre',
  'driverHourlyWage', 'holidayPayPct', 'profitMarginPct', 'extraLuggageProfitPct'
];

const nonNegativeGlobalFields = [
  'driverWageWeekday', 'driverWageWeekend', 'driverWageHoliday',
  'marginWeekday', 'marginWeekend', 'marginHoliday', 'overnightCost',
  'waitingChargePerHour', 'fuelPricePerLitre', 'driverHourlyWage',
  'holidayPayPct', 'profitMarginPct', 'extraLuggageProfitPct'
];

const positiveVehicleFields = ['capacity', 'fleetCount', 'utilisationDays', 'fuelKpl', 'expectedTyreLifeKm'];
const nonNegativeVehicleFields = [
  'ratePerKm', 'standingCostPerDay', 'commercialWeight', 'maintenanceCostPerKm',
  'tyreSetCost', 'fuelPricePerLitre', 'tyreCostPerKm', 'driverHourlyWage',
  'holidayPayPct', 'profitMarginPct', 'extraLuggageProfitPct'
];

function invalidNumericFields(record: any, fields: string[]) {
  return fields.filter(field => record?.[field] !== undefined && record[field] !== null && !Number.isFinite(Number(record[field])));
}

function validateVehicle(vehicle: any): string | null {
  if (!vehicle?.id || !String(vehicle.name || '').trim()) return 'Every vehicle requires an id and name';
  for (const field of positiveVehicleFields) {
    if (vehicle[field] !== undefined && (!Number.isFinite(Number(vehicle[field])) || Number(vehicle[field]) <= 0)) {
      return `${vehicle.name}: ${field} must be greater than zero`;
    }
  }
  if (Number(vehicle.capacity) <= 0 || Number(vehicle.fleetCount) <= 0) return `${vehicle.name}: capacity and fleet count are required`;
  for (const field of nonNegativeVehicleFields) {
    if (vehicle[field] !== undefined && (!Number.isFinite(Number(vehicle[field])) || Number(vehicle[field]) < 0)) {
      return `${vehicle.name}: ${field} must be a non-negative number`;
    }
  }
  for (const costs of [vehicle.annualCosts, vehicle.annualFixedCosts]) {
    if (costs !== undefined && (!Array.isArray(costs) || costs.some((cost: any) =>
      !String(cost?.label || '').trim() || !Number.isFinite(Number(cost?.cost ?? cost?.amount)) || Number(cost?.cost ?? cost?.amount) < 0))) {
      return `${vehicle.name}: annual costs require a label and non-negative amount`;
    }
  }
  return null;
}

function validateBlockedDates(blocks: any[], vehicleIds: Set<string>): string | null {
  for (const block of blocks) {
    const from = new Date(block?.from);
    const to = new Date(block?.to);
    if (!block?.id || !vehicleIds.has(String(block.vehicleId || '')) ||
      Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from ||
      !Number.isInteger(Number(block.units)) || Number(block.units) < 1 || !String(block.reason || '').trim()) {
      return 'Every blocked date requires an id, valid vehicle, date range, reason, and positive whole-unit count';
    }
  }
  return null;
}

export const getHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  return res.json({
    vehicles: db.data?.vehicles,
    globalVars: db.data?.globalVars,
    surcharges: db.data?.surcharges,
    annualOverheads: db.data?.annualOverheads,
    blockedDates: db.data?.blockedDates,
    operatorDetails: db.data?.operatorDetails
  });
}

export const postHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
  const config = req.body;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return res.status(400).json({ error: 'Configuration payload must be an object' });
  }
  if (config.vehicles !== undefined && !Array.isArray(config.vehicles)) {
    return res.status(400).json({ error: 'Vehicles must be an array' });
  }
  if (config.globalVars !== undefined && (typeof config.globalVars !== 'object' || Array.isArray(config.globalVars))) {
    return res.status(400).json({ error: 'Global variables must be an object' });
  }
  const invalidVehicle = config.vehicles?.map(validateVehicle).find(Boolean);
  if (invalidVehicle) {
    return res.status(400).json({ error: invalidVehicle });
  }
  const badGlobalFields = invalidNumericFields(config.globalVars, numericGlobalFields);
  if (badGlobalFields.length) return res.status(400).json({ error: `Invalid numeric settings: ${badGlobalFields.join(', ')}` });
  const negativeGlobalFields = nonNegativeGlobalFields.filter(field => config.globalVars?.[field] !== undefined && Number(config.globalVars[field]) < 0);
  if (negativeGlobalFields.length) return res.status(400).json({ error: `Settings cannot be negative: ${negativeGlobalFields.join(', ')}` });
  if (config.globalVars?.distanceUnit !== undefined && !['km', 'miles'].includes(config.globalVars.distanceUnit)) {
    return res.status(400).json({ error: 'Distance unit must be km or miles' });
  }
  if (config.globalVars?.yardLat !== undefined && (Number(config.globalVars.yardLat) < -90 || Number(config.globalVars.yardLat) > 90)) {
    return res.status(400).json({ error: 'Yard latitude must be between -90 and 90' });
  }
  if (config.globalVars?.yardLng !== undefined && (Number(config.globalVars.yardLng) < -180 || Number(config.globalVars.yardLng) > 180)) {
    return res.status(400).json({ error: 'Yard longitude must be between -180 and 180' });
  }
  if (config.surcharges !== undefined && (typeof config.surcharges !== 'object' || Array.isArray(config.surcharges) ||
    Object.entries(config.surcharges).some(([, value]) => !Number.isFinite(Number(value)) || Number(value) < 0))) {
    return res.status(400).json({ error: 'Every surcharge must be a non-negative number' });
  }
  if (config.annualOverheads && (!Array.isArray(config.annualOverheads) || config.annualOverheads.some((item: any) => !item?.label || !Number.isFinite(Number(item.cost)) || Number(item.cost) < 0))) {
    return res.status(400).json({ error: 'Annual overhead items require a label and non-negative cost' });
  }
  const vehicleIds = new Set<string>((config.vehicles || db.data?.vehicles || []).map((vehicle: any) => String(vehicle.id)));
  if (config.blockedDates !== undefined && !Array.isArray(config.blockedDates)) {
    return res.status(400).json({ error: 'Blocked dates must be an array' });
  }
  const blockedDateError = config.blockedDates ? validateBlockedDates(config.blockedDates, vehicleIds) : null;
  if (blockedDateError) return res.status(400).json({ error: blockedDateError });
  if (config.operatorDetails !== undefined && (typeof config.operatorDetails !== 'object' || Array.isArray(config.operatorDetails))) {
    return res.status(400).json({ error: 'Operator details must be an object' });
  }
  if (config.operatorDetails?.notificationEmail && !/^\S+@\S+\.\S+$/.test(String(config.operatorDetails.notificationEmail))) {
    return res.status(400).json({ error: 'Notification email is invalid' });
  }
  if (db.data) {
    if (config.vehicles) db.data.vehicles = config.vehicles;
    if (config.globalVars) {
      db.data.globalVars = {
        ...(db.data.globalVars || {}),
        ...config.globalVars
      };
    }
    if (config.surcharges) {
      db.data.surcharges = {
        ...(db.data.surcharges || {}),
        ...config.surcharges
      };
    }
    if (config.annualOverheads) db.data.annualOverheads = config.annualOverheads;
    if (config.blockedDates) db.data.blockedDates = config.blockedDates;
    if (config.operatorDetails) db.data.operatorDetails = config.operatorDetails;
    addActivity(db, 'configuration', 'Admin configuration updated');
    await db.write();
  }
  return res.json({ success: true });
}
