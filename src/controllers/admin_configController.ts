type Request = any; type Response = any; type NextFunction = any;
import { addActivity, getDatabase } from '../database/db';
import { fleetEconomics } from '../engines/pricingEngine';

const numericGlobalFields = [
  'driverWageWeekday', 'driverWageWeekend', 'driverWageHoliday',
  'marginWeekday', 'marginWeekend', 'marginHoliday', 'overnightCost',
  'waitingChargePerHour', 'yardLat', 'yardLng', 'fuelPricePerLitre',
  'driverHourlyWage', 'holidayPayPct', 'profitMarginPct', 'extraLuggageProfitPct',
  'netMarginPct', 'netProfitTarget', 'dualDriverThresholdHours', 'waitingWageFactor',
  'customerRangePct', 'walkaroundCheckMinutes'
];

const nonNegativeGlobalFields = [
  'driverWageWeekday', 'driverWageWeekend', 'driverWageHoliday',
  'marginWeekday', 'marginWeekend', 'marginHoliday', 'overnightCost',
  'waitingChargePerHour', 'fuelPricePerLitre', 'driverHourlyWage',
  'holidayPayPct', 'profitMarginPct', 'extraLuggageProfitPct', 'netMarginPct', 'netProfitTarget',
  'dualDriverThresholdHours', 'waitingWageFactor', 'customerRangePct', 'walkaroundCheckMinutes'
];

const positiveVehicleFields = ['capacity', 'fleetCount', 'utilisationDays', 'fuelKpl', 'expectedTyreLifeKm'];
const nonNegativeVehicleFields = [
  'ratePerKm', 'standingCostPerDay', 'commercialWeight', 'maintenanceCostPerKm',
  'sellingRateOneWay', 'sellingRateReturn', 'minimumHire', 'includedKmOneWay', 'includedKmReturn',
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
    const vId = String(block.vehicleId || '').trim();
    if (!block?.id || (vId !== '' && !vehicleIds.has(vId)) ||
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

  // 1. Heal vehicles
  if (config.vehicles && Array.isArray(config.vehicles)) {
    config.vehicles = config.vehicles.map((v: any) => {
      if (!v || typeof v !== 'object') return v;
      const dbVehicle = db.data?.vehicles?.find((x: any) => x.id === v.id) || {};

      // Positive fields must be finite and > 0
      for (const field of positiveVehicleFields) {
        const val = Number(v[field]);
        if (!Number.isFinite(val) || val <= 0) {
          v[field] = Number((dbVehicle as any)[field] || (field === 'capacity' ? 16 : field === 'fleetCount' ? 1 : 220));
        } else {
          v[field] = val;
        }
      }

      // Non-negative fields must be finite and >= 0
      for (const field of nonNegativeVehicleFields) {
        const val = Number(v[field]);
        if (!Number.isFinite(val) || val < 0) {
          v[field] = Number((dbVehicle as any)[field] || 0);
        } else {
          v[field] = val;
        }
      }

      // Annual costs sanitization
      for (const key of ['annualCosts', 'annualFixedCosts']) {
        if (v[key] !== undefined) {
          if (!Array.isArray(v[key])) {
            v[key] = [];
          } else {
            v[key] = v[key].map((cost: any, index: number) => {
              if (!cost || typeof cost !== 'object') return { id: index + 1, label: 'Unnamed Cost', cost: 0, name: 'Unnamed Cost', amount: 0 };
              const costLabel = String(cost.label || cost.name || '').trim() || 'Unnamed Cost';
              const costVal = Number(cost.cost ?? cost.amount ?? 0);
              const cleanVal = (Number.isFinite(costVal) && costVal >= 0) ? costVal : 0;
              return {
                id: cost.id ?? (index + 1),
                label: costLabel,
                cost: cleanVal,
                name: costLabel,
                amount: cleanVal
              };
            });
          }
        }
      }
      return v;
    });
  }

  // 2. Heal globalVars
  if (config.globalVars && typeof config.globalVars === 'object' && !Array.isArray(config.globalVars)) {
    const dbGv = db.data?.globalVars || {};
    for (const field of numericGlobalFields) {
      if ((config.globalVars as any)[field] !== undefined) {
        const val = Number((config.globalVars as any)[field]);
        if (!Number.isFinite(val)) {
          (config.globalVars as any)[field] = Number((dbGv as any)[field] || 0);
        } else if (nonNegativeGlobalFields.includes(field) && val < 0) {
          (config.globalVars as any)[field] = 0;
        } else {
          (config.globalVars as any)[field] = val;
        }
      }
    }
    if (config.globalVars.distanceUnit !== undefined && !['km', 'miles'].includes(config.globalVars.distanceUnit)) {
      config.globalVars.distanceUnit = (dbGv as any).distanceUnit || 'miles';
    }
    if (config.globalVars.yardLat !== undefined) {
      const lat = Number(config.globalVars.yardLat);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        config.globalVars.yardLat = Number((dbGv as any).yardLat || 51.5074);
      }
    }
    if (config.globalVars.yardLng !== undefined) {
      const lng = Number(config.globalVars.yardLng);
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        config.globalVars.yardLng = Number((dbGv as any).yardLng || -0.1278);
      }
    }
  }

  // 3. Heal surcharges
  if (config.surcharges && typeof config.surcharges === 'object' && !Array.isArray(config.surcharges)) {
    const dbSr = db.data?.surcharges || {};
    for (const [key, value] of Object.entries(config.surcharges)) {
      const val = Number(value);
      if (!Number.isFinite(val) || val < 0) {
        (config.surcharges as any)[key] = Number((dbSr as any)[key] || 0);
      } else {
        (config.surcharges as any)[key] = val;
      }
    }
  }

  // 4. Heal annualOverheads
  if (config.annualOverheads !== undefined) {
    if (!Array.isArray(config.annualOverheads)) {
      config.annualOverheads = [];
    } else {
      config.annualOverheads = config.annualOverheads.map((item: any, index: number) => {
        if (!item || typeof item !== 'object') return { id: index + 1, label: 'Unnamed Overhead', cost: 0 };
        const label = String(item.label || item.name || '').trim() || 'Unnamed Overhead';
        const cost = Number(item.cost ?? item.amount ?? 0);
        const cleanCost = (Number.isFinite(cost) && cost >= 0) ? cost : 0;
        return {
          id: item.id ?? (index + 1),
          label,
          cost: cleanCost
        };
      });
    }
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
  if (badGlobalFields.length)  return res.status(400).json({ error: `Invalid numeric settings: ${badGlobalFields.join(', ')}` });
  const negativeGlobalFields = nonNegativeGlobalFields.filter(field => config.globalVars?.[field] !== undefined && Number(config.globalVars[field]) < 0);
  if (negativeGlobalFields.length)  return res.status(400).json({ error: `Settings cannot be negative: ${negativeGlobalFields.join(', ')}` });
  const percentageMarginFields = ['marginWeekday', 'marginWeekend', 'marginHoliday', 'profitMarginPct', 'netMarginPct'];
  const invalidPercentageMargin = percentageMarginFields.find(field => config.globalVars?.[field] !== undefined && Number(config.globalVars[field]) >= 100);
  if (invalidPercentageMargin) {
     return res.status(400).json({ error: `${invalidPercentageMargin} must be less than 100%` });
  }
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
  if (blockedDateError)  return res.status(400).json({ error: blockedDateError });
  if (config.operatorDetails !== undefined && (typeof config.operatorDetails !== 'object' || Array.isArray(config.operatorDetails))) {
     return res.status(400).json({ error: 'Operator details must be an object' });
  }
  if (config.operatorDetails) {
    const requiredOperatorFields = ['companyName', 'operatorLicence', 'depotPostcode', 'notificationEmail'];
    const missingOperatorFields = requiredOperatorFields.filter(field => !String(config.operatorDetails[field] || '').trim());
    if (missingOperatorFields.length) {
       return res.status(400).json({ error: `Operator details cannot be blank: ${missingOperatorFields.join(', ')}` });
    }
    if (!/^\S+@\S+\.\S+$/.test(String(config.operatorDetails.notificationEmail))) {
       return res.status(400).json({ error: 'Notification email is invalid' });
    }
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

    // Minimum hire is derived from fleet economics (standing + overhead per
    // day), never hand-typed. Persist zero too: clearing all fixed costs is a
    // valid setting and must not resurrect the previous minimum hire on refresh.
    if (Array.isArray(db.data.vehicles)) {
      const economics = fleetEconomics(db.data);
      db.data.vehicles = db.data.vehicles.map((vehicle: any) => {
        const match = economics.vehicleBreakdown.find((v: any) => v.id === vehicle.id);
        return match ? { ...vehicle, minimumHire: Number(match.minHirePerDay) || 0 } : vehicle;
      });
    }

    if (config.blockedDates) db.data.blockedDates = config.blockedDates;
    if (config.operatorDetails) {
      db.data.operatorDetails = {
        ...(db.data.operatorDetails || {}),
        ...config.operatorDetails
      };
    }
    addActivity(db, 'configuration', 'Updated admin configuration', req.adminUser,
      Object.keys(config).map(field => ({ field, after: 'Updated' })));
    await db.write();
  }
  return res.json({ success: true });
}

