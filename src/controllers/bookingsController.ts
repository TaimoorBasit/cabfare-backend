type Request = any; type Response = any; type NextFunction = any;
import { getDatabase } from '../database/db';

export const getHandler = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase(req.env);
    if (!db.data) throw new Error("Database not initialized");

    const limit = req.query?.limit ? parseInt(req.query.limit, 10) : 500;
    const allBookings = db.data.bookings || [];
    const bookings = limit === -1 ? allBookings : allBookings.slice(0, limit);

    return res.json({ bookings });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}

export const postHandler = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase(req.env);
    if (!db.data) throw new Error("Database not initialized");

    const payload = req.body;
    
    
    if (!db.data.bookings) {
      db.data.bookings = [];
    }

    const newBooking = {
      id: 'BK-' + Date.now().toString(36).toUpperCase(),
      createdAt: new Date().toISOString(),
      ...payload
    };

    db.data.bookings.unshift(newBooking); 
    await db.write();

    return res.json({ success: true, booking: newBooking });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
