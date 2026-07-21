type Request = any; type Response = any; type NextFunction = any;
import { getDatabase } from '../database/db';

export const getHandler = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase(req.env);
    if (!db.data) throw new Error("Database not initialized");

    return res.json({ bookings: db.data.bookings || [] });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}

export const postHandler = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase(req.env);
    if (!db.data) throw new Error("Database not initialized");

    const payload = req.body;
    
    // Add missing bookings array if undefined
    if (!db.data.bookings) {
      db.data.bookings = [];
    }

    const newBooking = {
      id: 'BK-' + Date.now().toString(36).toUpperCase(),
      createdAt: new Date().toISOString(),
      ...payload
    };

    db.data.bookings.unshift(newBooking); // Add to beginning of array
    await db.write();

    return res.json({ success: true, booking: newBooking });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
