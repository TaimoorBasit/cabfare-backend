type Request = any; type Response = any;
import { addActivity, getDatabase, RouteTemplate } from '../database/db';

function finiteNonNegative(value: unknown) {
  return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function validateTemplate(item: any, vehicleIds: Set<string>): string | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Route template must be an object';
  if (!String(item.pickupArea || '').trim() || !String(item.dropArea || '').trim()) return 'Pickup and drop-off locations are required';
  if (!vehicleIds.has(String(item.vehicleId || ''))) return 'A valid vehicle is required';
  if (!['one-way', 'return'].includes(item.tripType)) return 'Trip type must be one-way or return';
  if (!finiteNonNegative(item.price)) return 'Fixed price must be a non-negative number';
  if (!finiteNonNegative(item.waitingChargePerHour)) return 'Waiting charge per hour must be explicitly configured';
  if (!finiteNonNegative(item.radiusKm)) return 'Match radius must be a non-negative number';
  for (const field of ['pickupGeo', 'dropGeo']) {
    const point = item[field];
    if (point !== undefined && point !== null &&
      (!Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng)))) {
      return `${field} coordinates are invalid`;
    }
  }
  return null;
}

function normalizedTemplate(item: any): RouteTemplate {
  return {
    ...item,
    pickupArea: String(item.pickupArea).trim(),
    dropArea: String(item.dropArea).trim(),
    price: Number(item.price),
    waitingChargePerHour: Number(item.waitingChargePerHour),
    radiusKm: Number(item.radiusKm)
  };
}

export const getHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  return res.json(db.data?.routeTemplates || []);
};

function healTemplate(item: any) {
  if (!item || typeof item !== 'object') return item;
  if (item.waitingChargePerHour === undefined || item.waitingChargePerHour === null || item.waitingChargePerHour === '' || !Number.isFinite(Number(item.waitingChargePerHour))) {
    item.waitingChargePerHour = 0;
  }
  if (item.radiusKm === undefined || item.radiusKm === null || item.radiusKm === '' || !Number.isFinite(Number(item.radiusKm))) {
    item.radiusKm = 0;
  }
  if (item.price === undefined || item.price === null || item.price === '' || !Number.isFinite(Number(item.price))) {
    item.price = 0;
  }
  if (!['one-way', 'return'].includes(item.tripType)) {
    item.tripType = 'one-way';
  }
  return item;
}

export const postHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
  const item = healTemplate({ ...req.body, id: `template_${Date.now()}` });
  const error = validateTemplate(item, new Set((db.data.vehicles || []).map(vehicle => vehicle.id)));
  if (error) return res.status(400).json({ error });
  const template = normalizedTemplate(item);
  db.data.routeTemplates.push(template);
  addActivity(db, 'pricing', `Route template ${template.id} created`);
  await db.write();
  return res.status(201).json(template);
};

export const putHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
  const item = healTemplate(req.body);
  if (!item?.id) return res.status(400).json({ error: 'Template id is required' });
  const index = db.data.routeTemplates.findIndex(template => template.id === item.id);
  if (index < 0) return res.status(404).json({ error: 'Route template not found' });
  const error = validateTemplate(item, new Set((db.data.vehicles || []).map(vehicle => vehicle.id)));
  if (error) return res.status(400).json({ error });
  const template = normalizedTemplate(item);
  db.data.routeTemplates[index] = template;
  addActivity(db, 'pricing', `Route template ${template.id} updated`);
  await db.write();
  return res.json(template);
};

export const deleteHandler = async (req: Request, res: Response) => {
  const id = String(req.query?.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Template id is required' });
  const db = await getDatabase(req.env);
  if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
  const before = db.data.routeTemplates.length;
  db.data.routeTemplates = db.data.routeTemplates.filter(template => template.id !== id);
  if (db.data.routeTemplates.length === before) return res.status(404).json({ error: 'Route template not found' });
  addActivity(db, 'pricing', `Route template ${id} deleted`);
  await db.write();
  return res.json({ success: true });
};
