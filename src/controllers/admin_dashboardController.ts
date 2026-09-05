type Request = any;
type Response = any;

import { DatabaseSchema, getDatabase } from '../database/db';

type RecordLike = Record<string, any>;

const REVENUE_STATUSES = new Set(['accepted', 'confirmed', 'completed', 'paid']);
const PENDING_STATUSES = new Set([
  'pending',
  'draft',
  'sent',
  'quoted',
  'new',
  'requested',
  'awaiting',
  'awaiting_payment'
]);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'rejected', 'expired']);

function finiteNumber(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value: unknown): number | null {
  const number = finiteNumber(value);
  if (number === null || number <= 0) return null;
  return Math.ceil(number);
}

function bookingStatus(booking: RecordLike): string {
  return String(
    booking.status ??
    booking.bookingStatus ??
    booking.quoteStatus ??
    booking.quote?.status ??
    // Bookings created before statuses were introduced are still genuine new
    // enquiries. Treat them as such instead of dropping them into an
    // "unclassified" bucket on the dashboard.
    'new'
  ).trim().toLowerCase();
}

function bookingPrice(booking: RecordLike): number | null {
  const candidates = [
    booking.quote?.result?.finalPrice,
    booking.quote?.finalPrice,
    booking.finalPrice,
    booking.totalFare,
    booking.fare
  ];

  for (const candidate of candidates) {
    const amount = finiteNumber(candidate);
    if (amount !== null && amount >= 0) return amount;
  }
  return null;
}

function bookingVehicleId(booking: RecordLike): string | null {
  const value =
    booking.quote?.vehicle?.id ??
    booking.assignedVehicleId ??
    booking.vehicleId ??
    booking.assignedFleet?.id;
  return value === null || value === undefined || String(value).trim() === ''
    ? null
    : String(value);
}

function bookingDeparture(booking: RecordLike): Date | null {
  const value = booking.journey?.departureDate ?? booking.departureDate;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function bookingEnd(booking: RecordLike, departure: Date): Date | null {
  const explicit = booking.journey?.returnDate ?? booking.returnDate;
  if (explicit) {
    const end = new Date(explicit);
    if (!Number.isNaN(end.getTime()) && end >= departure) return end;
  }

  const shiftHours = finiteNumber(booking.quote?.result?.totalShiftHrs);
  if (shiftHours !== null && shiftHours > 0) {
    return new Date(departure.getTime() + shiftHours * 60 * 60 * 1000);
  }
  return null;
}

function bookingVehicleUnits(booking: RecordLike, vehicles: RecordLike[]): number {
  const explicit = positiveInteger(
    booking.quote?.result?.vehicleCount ??
    booking.vehicleCount ??
    booking.assignedVehicleCount
  );
  if (explicit !== null) return explicit;

  if (Array.isArray(booking.assignedVehicles) && booking.assignedVehicles.length > 0) {
    return booking.assignedVehicles.length;
  }

  const vehicleId = bookingVehicleId(booking);
  const passengers = positiveInteger(booking.journey?.passengers ?? booking.passengers);
  const capacity = positiveInteger(vehicles.find(vehicle => vehicle.id === vehicleId)?.capacity);
  if (passengers !== null && capacity !== null) return Math.ceil(passengers / capacity);

  return vehicleId ? 1 : 0;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseBoundary(value: unknown, endOfDay = false): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
    : trimmed;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeBlock(block: RecordLike, source: 'blockedDates' | 'vehicleAvailability') {
  const from = parseBoundary(block.from ?? block.startDate ?? block.date);
  const to = parseBoundary(block.to ?? block.endDate ?? block.date, true) ?? from;
  if (!from || !to || to < from) return null;

  return {
    id: block.id ? String(block.id) : null,
    vehicleId: block.vehicleId ? String(block.vehicleId) : null,
    from: from.toISOString(),
    to: to.toISOString(),
    units: positiveInteger(block.units) ?? 1,
    reason: block.reason ? String(block.reason) : null,
    source
  };
}

function recognizedRevenue(booking: RecordLike): number {
  if (!REVENUE_STATUSES.has(bookingStatus(booking))) return 0;
  return bookingPrice(booking) ?? 0;
}

function quotedValue(booking: RecordLike): number {
  return bookingPrice(booking) ?? 0;
}

export function buildDashboardMetrics(data: DatabaseSchema, now = new Date()) {
  const bookings = Array.isArray(data.bookings) ? data.bookings : [];
  const storedQuotes = Array.isArray(data.quotes) ? data.quotes : [];
  const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  const vehicleNames = new Map(vehicles.map(vehicle => [String(vehicle.id), vehicle.name]));
  const blocks = [
    ...(Array.isArray(data.blockedDates)
      ? data.blockedDates.map(block => normalizeBlock(block, 'blockedDates'))
      : []),
    ...(Array.isArray(data.vehicleAvailability)
      ? data.vehicleAvailability.map(block => normalizeBlock(block, 'vehicleAvailability'))
      : [])
  ].filter((block): block is NonNullable<ReturnType<typeof normalizeBlock>> => block !== null);

  const totalFleetUnits = vehicles.reduce(
    (sum, vehicle) => sum + (positiveInteger(vehicle.fleetCount) ?? 0),
    0
  );

  const currentlyBlockedByVehicle = new Map<string, number>();
  for (const block of blocks) {
    if (!block.vehicleId) continue;
    if (new Date(block.from) <= now && new Date(block.to) >= now) {
      currentlyBlockedByVehicle.set(
        block.vehicleId,
        (currentlyBlockedByVehicle.get(block.vehicleId) ?? 0) + block.units
      );
    }
  }

  const currentlyBookedByVehicle = new Map<string, number>();
  for (const booking of bookings) {
    const status = bookingStatus(booking);
    if (CANCELLED_STATUSES.has(status)) continue;
    const vehicleId = bookingVehicleId(booking);
    const departure = bookingDeparture(booking);
    if (!vehicleId || !departure || departure > now) continue;
    const end = bookingEnd(booking, departure);
    if (!end || end < now) continue;
    currentlyBookedByVehicle.set(
      vehicleId,
      (currentlyBookedByVehicle.get(vehicleId) ?? 0) + bookingVehicleUnits(booking, vehicles)
    );
  }

  let blockedFleetUnits = 0;
  let activeFleetUnits = 0;
  let availableFleetUnits = 0;
  const fleetByVehicle = vehicles.map(vehicle => {
    const configured = positiveInteger(vehicle.fleetCount) ?? 0;
    const blocked = Math.min(configured, currentlyBlockedByVehicle.get(String(vehicle.id)) ?? 0);
    const active = Math.max(0, configured - blocked);
    const booked = Math.min(active, currentlyBookedByVehicle.get(String(vehicle.id)) ?? 0);
    const available = Math.max(0, active - booked);
    blockedFleetUnits += blocked;
    activeFleetUnits += active;
    availableFleetUnits += available;
    return {
      vehicleId: String(vehicle.id),
      name: String(vehicle.name),
      configuredUnits: configured,
      blockedUnits: blocked,
      bookedUnits: booked,
      activeUnits: active,
      availableUnits: available
    };
  });

  const selectedDate = dateKey(now);
  const daily = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    bookingCount: 0,
    vehicleUnits: 0,
    recognizedRevenue: 0,
    quotedValue: 0
  }));
  const weeklyDates = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - (6 - offset)
    ));
    return dateKey(date);
  });
  const weekly = weeklyDates.map(date => ({
    date,
    bookingCount: 0,
    vehicleUnits: 0,
    recognizedRevenue: 0,
    quotedValue: 0
  }));
  const weeklyByDate = new Map(weekly.map(bucket => [bucket.date, bucket]));
  const monthlyKeys = Array.from({ length: 12 }, (_, offset) => {
    const date = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - (11 - offset),
      1
    ));
    return date.toISOString().slice(0, 7);
  });
  const monthly = monthlyKeys.map(month => ({
    month,
    bookingCount: 0,
    vehicleUnits: 0,
    recognizedRevenue: 0,
    quotedValue: 0
  }));
  const monthlyByKey = new Map(monthly.map(bucket => [bucket.month, bucket]));

  for (const booking of bookings) {
    const departure = bookingDeparture(booking);
    if (!departure) continue;
    const units = bookingVehicleUnits(booking, vehicles);
    const revenue = recognizedRevenue(booking);
    const value = quotedValue(booking);
    const departureDate = dateKey(departure);

    if (departureDate === selectedDate) {
      const bucket = daily[departure.getUTCHours()];
      bucket.bookingCount += 1;
      bucket.vehicleUnits += units;
      bucket.recognizedRevenue += revenue;
      bucket.quotedValue += value;
    }

    const weekBucket = weeklyByDate.get(departureDate);
    if (weekBucket) {
      weekBucket.bookingCount += 1;
      weekBucket.vehicleUnits += units;
      weekBucket.recognizedRevenue += revenue;
      weekBucket.quotedValue += value;
    }

    const monthBucket = monthlyByKey.get(departureDate.slice(0, 7));
    if (monthBucket) {
      monthBucket.bookingCount += 1;
      monthBucket.vehicleUnits += units;
      monthBucket.recognizedRevenue += revenue;
      monthBucket.quotedValue += value;
    }
  }

  const financialGroups = new Map<string, {
    vehicleId: string | null;
    name: string;
    bookingCount: number;
    recognizedRevenue: number;
    quotedValue: number;
  }>();
  for (const booking of bookings) {
    const vehicleId = bookingVehicleId(booking);
    const key = vehicleId ?? 'unassigned';
    const existing = financialGroups.get(key) ?? {
      vehicleId,
      name: vehicleId ? (vehicleNames.get(vehicleId) ?? vehicleId) : 'Unassigned',
      bookingCount: 0,
      recognizedRevenue: 0,
      quotedValue: 0
    };
    existing.bookingCount += 1;
    existing.recognizedRevenue += recognizedRevenue(booking);
    existing.quotedValue += quotedValue(booking);
    financialGroups.set(key, existing);
  }

  const statusCounts = new Map<string, number>();
  for (const booking of bookings) {
    const status = bookingStatus(booking) || 'unclassified';
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }

  const upcomingBlockedDates = blocks
    .filter(block => new Date(block.to) >= now)
    .sort((a, b) => a.from.localeCompare(b.from))
    .map(block => ({
      ...block,
      vehicleName: block.vehicleId ? (vehicleNames.get(block.vehicleId) ?? null) : null
    }));

  const recentActivity = (Array.isArray(data.activityLog) ? data.activityLog : [])
    .filter(item => item && item.createdAt && !Number.isNaN(new Date(item.createdAt).getTime()))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20)
    .map(item => ({
      id: String(item.id),
      type: String(item.type),
      message: String(item.message),
      createdAt: new Date(item.createdAt).toISOString()
    }));

  const pendingBookings = bookings.filter(booking => PENDING_STATUSES.has(bookingStatus(booking))).length;
  const unclassifiedBookings = 0;
  const totalRecognizedRevenue = bookings.reduce((sum, booking) => sum + recognizedRevenue(booking), 0);
  const totalQuotedValue = bookings.reduce((sum, booking) => sum + quotedValue(booking), 0);

  return {
    generatedAt: now.toISOString(),
    totals: {
      bookings: bookings.length,
      storedQuotes: storedQuotes.length,
      pricedBookings: bookings.filter(booking => bookingPrice(booking) !== null).length,
      pendingBookings,
      unclassifiedBookings,
      recognizedRevenue: totalRecognizedRevenue,
      quotedValue: totalQuotedValue,
      configuredFleetUnits: totalFleetUnits,
      activeFleetUnits,
      availableFleetUnits,
      blockedFleetUnits
    },
    fleet: {
      byVehicle: fleetByVehicle
    },
    activity: {
      selectedDate,
      daily,
      weekly,
      monthly
    },
    financial: {
      recognizedRevenue: totalRecognizedRevenue,
      quotedValue: totalQuotedValue,
      byVehicle: Array.from(financialGroups.values()),
      byBookingStatus: Array.from(statusCounts, ([status, bookingCount]) => ({ status, bookingCount }))
    },
    upcomingBlockedDates,
    recentBookings: [...bookings]
      .filter(booking => booking?.createdAt && !Number.isNaN(new Date(booking.createdAt).getTime()))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8),
    recentActivity,
    definitions: {
      recognizedRevenueStatuses: Array.from(REVENUE_STATUSES),
      pendingStatuses: Array.from(PENDING_STATUSES),
      activeFleetUnits: 'Configured fleet units minus units currently blocked.',
      availableFleetUnits: 'Active fleet units minus units assigned to journeys active at generatedAt.',
      quotedValue: 'Sum of persisted booking quote amounts regardless of booking status.'
    }
  };
}

export const getHandler = async (req: Request, res: Response) => {
  try {
    const db = await getDatabase(req.env);
    if (!db.data) return res.status(503).json({ error: 'Database not initialized' });
    if (!Array.isArray(db.data.bookings) || db.data.bookings.length === 0) {
      const bookings = await db.readBookings();
      if (Array.isArray(bookings)) db.data.bookings = bookings;
    }
    return res.json(buildDashboardMetrics(db.data));
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Unable to load dashboard metrics' });
  }
};
