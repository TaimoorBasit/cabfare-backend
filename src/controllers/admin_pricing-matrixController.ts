type Request = any; type Response = any;
import { addActivity, getDatabase, PricingMatrixRule } from '../database/db';

const validScopes = new Set(['global', 'fleet', 'city']);
const validTripTypes = new Set(['any', 'one-way', 'return']);
const validStatuses = new Set(['active', 'inactive']);

function finite(value: unknown) {
  return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
}

function validateRule(item: any, vehicleIds: Set<string>): string | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Pricing matrix rule must be an object';
  if (!validScopes.has(item.scope)) return 'Scope must be global, fleet, or city';
  if (!validTripTypes.has(item.tripType)) return 'Trip type must be any, one-way, or return';
  if (!validStatuses.has(item.status)) return 'Status must be active or inactive';
  if ((item.scope === 'fleet' || item.scope === 'city') && !vehicleIds.has(String(item.vehicleId || ''))) {
    return 'Fleet and city rules require a valid vehicle';
  }
  if (item.scope === 'city' && (!String(item.pickupArea || '').trim() || !String(item.dropArea || '').trim())) {
    return 'City rules require pickup and drop areas';
  }

  const nonNegativeFields = ['baseFare', 'includedLiveMileage', 'includedDeadMileage', 'waitingChargePerHour'];
  const invalidField = nonNegativeFields.find(field => !finite(item[field]) || Number(item[field]) < 0);
  if (invalidField) return `${invalidField} must be a non-negative number`;
  for (const field of ['nightRateMultiplier', 'weekendRateMultiplier']) {
    if (!finite(item[field]) || Number(item[field]) <= 0) return `${field} must be greater than zero`;
  }

  if (!Array.isArray(item.distanceBands) || item.distanceBands.length !== 4) {
    return 'Exactly four independently stored distance bands are required';
  }
  const bands = [...item.distanceBands].sort((a, b) => Number(a.min) - Number(b.min));
  if (Number(bands[0]?.min) !== 0) return 'Distance bands must begin at zero';
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    if (!finite(band.min) || Number(band.min) < 0 || !finite(band.rate) || Number(band.rate) < 0) {
      return 'Each distance band requires a non-negative minimum and rate';
    }
    const isLast = index === bands.length - 1;
    if (isLast) {
      if (band.max !== null) return 'The final distance band must have no upper limit';
    } else {
      if (!finite(band.max) || Number(band.max) <= Number(band.min)) return 'Distance band maximums must exceed their minimums';
      if (Number(bands[index + 1].min) !== Number(band.max)) return 'Distance bands must be contiguous without gaps or overlaps';
    }
  }
  return null;
}

function normalizedRule(item: any): PricingMatrixRule {
  return {
    ...item,
    vehicleId: item.scope === 'global' ? '' : String(item.vehicleId || ''),
    pickupArea: item.scope === 'city' ? String(item.pickupArea).trim() : 'Any',
    dropArea: item.scope === 'city' ? String(item.dropArea).trim() : 'Any',
    baseFare: Number(item.baseFare),
    includedLiveMileage: Number(item.includedLiveMileage),
    includedDeadMileage: Number(item.includedDeadMileage),
    waitingChargePerHour: Number(item.waitingChargePerHour),
    nightRateMultiplier: Number(item.nightRateMultiplier),
    weekendRateMultiplier: Number(item.weekendRateMultiplier),
    distanceBands: [...item.distanceBands]
      .sort((a: any, b: any) => Number(a.min) - Number(b.min))
      .map((band: any) => ({ min: Number(band.min), max: band.max === null ? null : Number(band.max), rate: Number(band.rate) }))
  };
}

export const getHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  return res.json(db.data?.pricingMatrix || []);
};

export const postHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
  const item = { ...req.body, id: `matrix_${Date.now()}` };
  const error = validateRule(item, new Set((db.data.vehicles || []).map(vehicle => vehicle.id)));
  if (error) return res.status(400).json({ error });
  const rule = normalizedRule(item);
  db.data.pricingMatrix.push(rule);
  addActivity(db, 'pricing', `Created pricing matrix rule ${rule.id}`, req.adminUser);
  await db.writeSections({ pricingMatrix: db.data.pricingMatrix, activityLog: db.data.activityLog });
  return res.status(201).json(rule);
};

export const putHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
  const item = req.body;
  if (!item?.id) return res.status(400).json({ error: 'Rule id is required' });
  const index = db.data.pricingMatrix.findIndex(rule => rule.id === item.id);
  if (index < 0) return res.status(404).json({ error: 'Pricing matrix rule not found' });
  const error = validateRule(item, new Set((db.data.vehicles || []).map(vehicle => vehicle.id)));
  if (error) return res.status(400).json({ error });
  const rule = normalizedRule(item);
  db.data.pricingMatrix[index] = rule;
  addActivity(db, 'pricing', `Updated pricing matrix rule ${rule.id}`, req.adminUser);
  await db.writeSections({ pricingMatrix: db.data.pricingMatrix, activityLog: db.data.activityLog });
  return res.json(rule);
};

export const deleteHandler = async (req: Request, res: Response) => {
  const id = String(req.query?.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Rule id is required' });
  const db = await getDatabase(req.env);
  if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
  const before = db.data.pricingMatrix.length;
  db.data.pricingMatrix = db.data.pricingMatrix.filter(rule => rule.id !== id);
  if (db.data.pricingMatrix.length === before) return res.status(404).json({ error: 'Pricing matrix rule not found' });
  addActivity(db, 'pricing', `Deleted pricing matrix rule ${id}`, req.adminUser);
  await db.writeSections({ pricingMatrix: db.data.pricingMatrix, activityLog: db.data.activityLog });
  return res.json({ success: true });
};
