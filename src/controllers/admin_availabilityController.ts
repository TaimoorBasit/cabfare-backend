type Request = any; type Response = any;
import { addActivity, getDatabase } from '../database/db';

function validateBlock(item: any, vehicleIds: Set<string>): string | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Availability block must be an object';
  if (!vehicleIds.has(String(item.vehicleId || ''))) return 'A valid vehicle is required';
  const from = new Date(item.from || item.startDate);
  const to = new Date(item.to || item.endDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return 'A valid start and end date are required';
  const units = Number(item.units ?? 1);
  if (!Number.isInteger(units) || units < 1) return 'Blocked units must be a positive whole number';
  if (!String(item.reason || '').trim()) return 'A reason is required';
  return null;
}

export const getHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  return res.json(db.data?.vehicleAvailability || []);
};

export const postHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
  const item = { ...req.body, id: `block_${Date.now()}`, units: Number(req.body?.units ?? 1) };
  const error = validateBlock(item, new Set((db.data.vehicles || []).map(vehicle => vehicle.id)));
  if (error) return res.status(400).json({ error });
  db.data.vehicleAvailability.push(item);
  addActivity(db, 'availability', `Created availability block ${item.id}`, req.adminUser);
  await db.write();
  return res.status(201).json(item);
};

export const deleteHandler = async (req: Request, res: Response) => {
  const id = String(req.query?.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Availability block id is required' });
  const db = await getDatabase(req.env);
  if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
  const before = db.data.vehicleAvailability.length;
  db.data.vehicleAvailability = db.data.vehicleAvailability.filter(block => block.id !== id);
  if (db.data.vehicleAvailability.length === before) return res.status(404).json({ error: 'Availability block not found' });
  addActivity(db, 'availability', `Deleted availability block ${id}`, req.adminUser);
  await db.write();
  return res.json({ success: true });
};
