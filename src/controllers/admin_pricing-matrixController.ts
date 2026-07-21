type Request = any; type Response = any; type NextFunction = any;
import { getDatabase } from '../database/db';

export const getHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  return res.json(db.data?.pricingMatrix || []);
}

export const postHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  const item = req.body;
  if (!item.id) item.id = 'matrix_' + Date.now();
  db.data?.pricingMatrix.push(item);
  await db.write();
  return res.json(item);
}

export const putHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  const item = req.body;
  const index = db.data?.pricingMatrix.findIndex(m => m.id === item.id);
  if (index !== undefined && index > -1 && db.data) {
    db.data.pricingMatrix[index] = item;
    await db.write();
    return res.json(item);
  }
  return res.status(404).json({ error: 'Not found' });
}

export const deleteHandler = async (req: Request, res: Response) => {
  const id = req.query.id as string;
  const db = await getDatabase(req.env);
  if (db.data) {
    db.data.pricingMatrix = db.data.pricingMatrix.filter(m => m.id !== id);
    await db.write();
    return res.json({ success: true });
  }
  return res.status(404).json({ error: 'Not found' });
}
