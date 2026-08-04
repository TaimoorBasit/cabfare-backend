type Request = any; type Response = any;
import { addActivity, getDatabase, SeasonalPricing } from '../database/db';

function finite(value: unknown) {
  return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
}

function validateSeason(item: any, vehicleIds: Set<string>): string | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Seasonal rule must be an object';
  if (!String(item.seasonName || item.name || '').trim()) return 'Season name is required';
  const start = new Date(item.startDate);
  const end = new Date(item.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 'A valid date range is required';
  const hasMultiplier = finite(item.multiplier);
  const hasOverride = finite(item.overrideFare);
  if (hasMultiplier === hasOverride) return 'Configure either a positive multiplier or a non-negative override fare';
  if (hasMultiplier && Number(item.multiplier) <= 0) return 'Multiplier must be greater than zero';
  if (hasOverride && Number(item.overrideFare) < 0) return 'Override fare cannot be negative';
  if (!finite(item.priority) || Number(item.priority) < 0) return 'Priority must be a non-negative number';
  if (typeof item.enabled !== 'boolean') return 'Enabled must be true or false';
  if (!Array.isArray(item.applicableVehicles) || !Array.isArray(item.applicableRoutes)) return 'Applicable vehicles and routes must be arrays';
  const invalidVehicle = item.applicableVehicles.find((id: any) => id !== 'Any' && !vehicleIds.has(String(id)));
  if (invalidVehicle) return `Unknown applicable vehicle: ${invalidVehicle}`;
  return null;
}

function normalizedSeason(item: any): SeasonalPricing {
  const hasOverride = finite(item.overrideFare);
  return {
    ...item,
    seasonName: String(item.seasonName || item.name).trim(),
    multiplier: hasOverride ? undefined : Number(item.multiplier),
    overrideFare: hasOverride ? Number(item.overrideFare) : undefined,
    priority: Number(item.priority),
    applicableVehicles: item.applicableVehicles.map((value: any) => String(value).trim()).filter(Boolean),
    applicableRoutes: item.applicableRoutes.map((value: any) => String(value).trim()).filter(Boolean)
  };
}

export const getHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  return res.json(db.data?.seasonalPricing || []);
};

export const postHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
  const item = { ...req.body, id: `season_${Date.now()}` };
  const error = validateSeason(item, new Set((db.data.vehicles || []).map(vehicle => vehicle.id)));
  if (error) return res.status(400).json({ error });
  const season = normalizedSeason(item);
  db.data.seasonalPricing.push(season);
  addActivity(db, 'pricing', `Seasonal rule ${season.id} created`);
  await db.write();
  return res.status(201).json(season);
};

export const putHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
  const item = req.body;
  if (!item?.id) return res.status(400).json({ error: 'Seasonal rule id is required' });
  const index = db.data.seasonalPricing.findIndex(rule => rule.id === item.id);
  if (index < 0) return res.status(404).json({ error: 'Seasonal rule not found' });
  const error = validateSeason(item, new Set((db.data.vehicles || []).map(vehicle => vehicle.id)));
  if (error) return res.status(400).json({ error });
  const season = normalizedSeason(item);
  db.data.seasonalPricing[index] = season;
  addActivity(db, 'pricing', `Seasonal rule ${season.id} updated`);
  await db.write();
  return res.json(season);
};

export const deleteHandler = async (req: Request, res: Response) => {
  const id = String(req.query?.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Seasonal rule id is required' });
  const db = await getDatabase(req.env);
  if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
  const before = db.data.seasonalPricing.length;
  db.data.seasonalPricing = db.data.seasonalPricing.filter(rule => rule.id !== id);
  if (db.data.seasonalPricing.length === before) return res.status(404).json({ error: 'Seasonal rule not found' });
  addActivity(db, 'pricing', `Seasonal rule ${id} deleted`);
  await db.write();
  return res.json({ success: true });
};
