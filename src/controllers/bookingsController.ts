type Request = any; type Response = any;
import { addActivity, getDatabase } from '../database/db';

const allowedStatuses = new Set([
  'new', 'pending', 'draft', 'sent', 'quoted', 'accepted', 'confirmed',
  'completed', 'paid', 'rejected', 'cancelled', 'canceled', 'expired'
]);

function validateBookingPayload(payload: any, partial = false): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Booking payload must be an object';
  }

  if (!partial || payload.customer !== undefined) {
    const customer = payload.customer;
    if (!customer || typeof customer !== 'object') return 'Customer details are required';
    if (!String(customer.name || '').trim()) return 'Customer name is required';
    if (!/^\S+@\S+\.\S+$/.test(String(customer.email || '').trim())) return 'A valid customer email is required';
  }

  if (!partial || payload.journey !== undefined) {
    const journey = payload.journey;
    if (!journey || typeof journey !== 'object') return 'Journey details are required';
    if (!String(journey.origin || '').trim() || !String(journey.destination || '').trim()) {
      return 'Pickup and destination are required';
    }
    if (!['one-way', 'return'].includes(journey.journeyType)) {
      return 'Journey type must be one-way or return';
    }
    const passengers = Number(journey.passengers);
    if (!Number.isInteger(passengers) || passengers < 1 || passengers > 500) {
      return 'Passengers must be a whole number between 1 and 500';
    }
    const departure = new Date(journey.departureDate);
    if (Number.isNaN(departure.getTime())) return 'A valid departure date is required';
    if (journey.journeyType === 'return') {
      const returning = new Date(journey.returnDate);
      if (Number.isNaN(returning.getTime()) || returning <= departure) {
        return 'Return date must be after the departure date';
      }
    }
  }

  if (payload.status !== undefined && !allowedStatuses.has(String(payload.status).toLowerCase())) {
    return 'Booking status is invalid';
  }
  return null;
}

export const getHandler = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase(req.env);
    if (!db.data) throw new Error("Database not initialized");
    let savedBookings: any[] | null = null;
    try { savedBookings = await db.readBookings(); } catch (indexError) { console.error('Booking index read failed:', indexError); }
    if (savedBookings) db.data.bookings = savedBookings;
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
    const validationError = validateBookingPayload(payload);
    if (validationError) return res.status(400).json({ error: validationError });

    if (!db.data.bookings) {
      db.data.bookings = [];
    }

    const newBooking = {
      id: 'BK-' + Date.now().toString(36).toUpperCase(),
      createdAt: new Date().toISOString(),
      status: 'new',
      ...payload,
      updatedAt: new Date().toISOString()
    };

    db.data.bookings.unshift(newBooking);
    addActivity(db, 'booking', `New booking ${newBooking.id} received`, req.adminUser);
    await db.writeBookings(db.data.bookings);

    return res.status(201).json({ success: true, booking: newBooking });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}

export const putHandler = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase(req.env);
    if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
    const payload = req.body;
    const id = String(payload?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Booking id is required' });
    const validationError = validateBookingPayload(payload, true);
    if (validationError) return res.status(400).json({ error: validationError });

    const index = (db.data.bookings || []).findIndex((booking: any) => booking.id === id);
    if (index < 0) return res.status(404).json({ error: 'Booking not found' });

    const existing = db.data.bookings[index];
    
    const updatedBooking = {
      ...existing,
      ...payload,
      id: existing.id,
      createdAt: existing.createdAt,
      customer: payload.customer ? { ...(existing.customer || {}), ...payload.customer } : existing.customer,
      journey: payload.journey ? { ...(existing.journey || {}), ...payload.journey } : existing.journey,
      quote: payload.quote ? { ...(existing.quote || {}), ...payload.quote } : existing.quote,
      updatedAt: new Date().toISOString()
    };
    db.data.bookings[index] = updatedBooking;
    addActivity(db, 'booking', `Updated booking ${id}`, req.adminUser);
    await db.writeBookings(db.data.bookings);

    return res.json({ success: true, booking: updatedBooking });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Unable to update booking' });
  }
};

export const deleteHandler = async (req: Request, res: Response) => {
  try {
    const id = String(req.query?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Booking id is required' });
    const db = await getDatabase(req.env);
    if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
    const before = (db.data.bookings || []).length;
    db.data.bookings = (db.data.bookings || []).filter((booking: any) => booking.id !== id);
    if (db.data.bookings.length === before) return res.status(404).json({ error: 'Booking not found' });
    addActivity(db, 'booking', `Deleted booking ${id}`, req.adminUser);
    await db.writeBookings(db.data.bookings);
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Unable to delete booking' });
  }
};
