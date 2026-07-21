type Request = any; type Response = any; type NextFunction = any;
import { getDatabase } from '../database/db';

export const getHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  return res.json({
    vehicles: db.data?.vehicles,
    globalVars: db.data?.globalVars,
    surcharges: db.data?.surcharges,
    annualOverheads: db.data?.annualOverheads,
    blockedDates: db.data?.blockedDates
  });
}

export const postHandler = async (req: Request, res: Response) => {
  const db = await getDatabase(req.env);
  const config = req.body;
  if (db.data) {
    if (config.vehicles) db.data.vehicles = config.vehicles;
    if (config.globalVars) db.data.globalVars = config.globalVars;
    if (config.surcharges) db.data.surcharges = config.surcharges;
    if (config.annualOverheads) db.data.annualOverheads = config.annualOverheads;
    if (config.blockedDates) db.data.blockedDates = config.blockedDates;
    await db.write();
  }
  return res.json({ success: true });
}
