
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import seedData from './seed.json';

// Kept relative so Cloudflare can validate the Worker bundle. This path is
// touched only by the local-file fallback; production uses CABFARE_DB KV.
const localDatabasePath = '.data/db.json';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: string;
  role?: 'owner' | 'admin' | 'quotes' | 'custom';
  permissions?: string[];
  status?: 'active' | 'invited' | 'suspended';
  inviteTokenHash?: string;
  inviteExpiresAt?: string;
  resetTokenHash?: string;
  resetExpiresAt?: string;
  lastLoginAt?: string;
  lastActiveAt?: string;
  usageMinutes?: number;
  usageSeconds?: number;
  loginCount?: number;
  sessionStartedAt?: string;
  sessionLastSeenAt?: string;
  usageByDate?: Record<string, { minutes: number; seconds?: number; logins: number; lastLoginAt?: string; lastActiveAt?: string }>;
}

export interface PricingMatrixRule {
  id: string;
  pickupArea: string;
  dropArea: string;
  tripType: string;
  vehicleId: string;
  baseFare: number;
  includedLiveMileage: number;
  includedDeadMileage: number;
  waitingChargePerHour: number;
  extraMileageRate: number;
  nightRateMultiplier: number;
  weekendRateMultiplier: number;
  status: 'active' | 'inactive';
  scope?: 'global' | 'fleet' | 'city';
  distanceBands?: {
    min: number;
    max: number | null;
    rate: number;
  }[];
  pickupGeo?: { lat: number; lng: number };
  dropGeo?: { lat: number; lng: number };
}

export interface RouteTemplate {
  id: string;
  pickupArea: string;
  dropArea: string;
  vehicleId: string;
  tripType: 'one-way' | 'return';
  price: number;
  pickupGeo?: { lat: number; lng: number };
  dropGeo?: { lat: number; lng: number };
  radiusKm?: number;
  waitingChargePerHour?: number;
}

export interface SeasonalPricing {
  id: string;
  seasonName: string;
  startDate: string;
  endDate: string;
  multiplier?: number;
  overrideFare?: number;
  applicableRoutes: string[];
  applicableVehicles: string[];
  priority: number;
  enabled: boolean;
}

export interface DatabaseSchema {
  users: User[];
  pricingMatrix: PricingMatrixRule[];
  routeTemplates: RouteTemplate[];
  seasonalPricing: SeasonalPricing[];
  mileageRules: any[];
  bookings: any[];
  quotes: any[];
  waitingCharges: any[];
  vehicleAvailability: any[];
  routeCache: any[];
  vehicles?: {
    id: string;
    name: string;
    capacity: number;
    emoji?: string;
    desc?: string;
    ratePerKm?: number;
    sellingRateOneWay?: number;
    sellingRateReturn?: number;
    minimumHire?: number;
    includedKmOneWay?: number;
    includedKmReturn?: number;
    standingCostPerDay?: number;
    commercialWeight?: number;
    
    fleetCount?: number;
    utilisationDays?: number;
    annualCosts?: any[];
    fuelKpl?: number;
    maintenanceCostPerKm?: number;
    tyreSetCost?: number;
    expectedTyreLifeKm?: number;
    fuelPricePerLitre?: number;
    tyreCostPerKm?: number;
    driverHourlyWage?: number;
    holidayPayPct?: number;
    profitMarginPct?: number;
    extraLuggageProfitPct?: number;
  }[];
  globalVars?: {
    driverWageWeekday?: number;
    driverWageWeekend?: number;
    driverWageHoliday?: number;
    marginWeekday?: number;
    marginWeekend?: number;
    marginHoliday?: number;
    overnightCost?: number;
    waitingChargePerHour?: number;
    yardAddress?: string;
    yardLat?: number;
    yardLng?: number;
    distanceUnit?: 'km' | 'miles';
    fuelPricePerLitre?: number;
    driverHourlyWage?: number;
    holidayPayPct?: number;
    profitMarginPct?: number;
    netMarginPct?: number;
    netProfitTarget?: number;
    extraLuggageProfitPct?: number;
    emptyLegThresholdKm?: number;
    dualDriverThresholdHours?: number;
    waitingWageFactor?: number;
    customerRangePct?: number;
    pricingModelVersion?: string;
  };
  operatorDetails?: {
    companyName?: string;
    operatorLicence?: string;
    depotPostcode?: string;
    notificationEmail?: string;
  };
  surcharges?: any;
  annualOverheads?: any[];
  blockedDates?: any[];
  activityLog?: {
    id: string;
    type: string;
    message: string;
    createdAt: string;
    actorId?: string;
    actorName?: string;
    changes?: { field: string; before?: unknown; after?: unknown }[];
  }[];
}

function createEmptyDatabase(): DatabaseSchema {
  return {
    users: [],
    pricingMatrix: structuredClone(seedData.pricingMatrix) as PricingMatrixRule[],
    routeTemplates: [],
    seasonalPricing: [],
    mileageRules: [],
    bookings: [],
    quotes: [],
    waitingCharges: [],
    vehicleAvailability: [],
    routeCache: [],
    vehicles: structuredClone(seedData.vehicles),
    globalVars: structuredClone(seedData.globalVars) as DatabaseSchema['globalVars'],
    operatorDetails: structuredClone(seedData.operatorDetails),
    surcharges: structuredClone(seedData.surcharges),
    annualOverheads: structuredClone(seedData.annualOverheads),
    blockedDates: [],
    activityLog: []
  };
}

function normalizeAccessData(data: DatabaseSchema) {
  if (!Array.isArray(data.users) || data.users.length === 0) return false;
  let changed = false;
  data.users.forEach((user, index) => {
    if (!user.role) { user.role = index === 0 ? 'owner' : 'admin'; changed = true; }
    if (!user.status) { user.status = 'active'; changed = true; }
    if (!Array.isArray(user.permissions)) { user.permissions = []; changed = true; }
    if (!Number.isFinite(Number(user.usageMinutes))) { user.usageMinutes = 0; changed = true; }
    if (!Number.isFinite(Number(user.usageSeconds))) { user.usageSeconds = 0; changed = true; }
    if (!Number.isFinite(Number(user.loginCount))) { user.loginCount = 0; changed = true; }
    if (!user.usageByDate || typeof user.usageByDate !== 'object') { user.usageByDate = {}; changed = true; }
  });
  return changed;
}

function normalizeVehicleCostAliases(data: DatabaseSchema) {
  let changed = false;
  for (const vehicle of data.vehicles || []) {
    const record = vehicle as any;
    const source = Array.isArray(record.annualFixedCosts)
      ? record.annualFixedCosts
      : Array.isArray(record.annualCosts) ? record.annualCosts : undefined;
    if (!source) continue;
    const costs = source.map((cost: any, index: number) => {
      const label = String(cost?.label || cost?.name || '').trim() || 'Unnamed Cost';
      const amount = Number(cost?.cost ?? cost?.amount ?? 0);
      return { id: cost?.id ?? index + 1, label, name: label, cost: Number.isFinite(amount) && amount >= 0 ? amount : 0, amount: Number.isFinite(amount) && amount >= 0 ? amount : 0 };
    });
    if (JSON.stringify(record.annualCosts) !== JSON.stringify(costs) || JSON.stringify(record.annualFixedCosts) !== JSON.stringify(costs)) {
      record.annualCosts = costs;
      record.annualFixedCosts = costs;
      changed = true;
    }
  }
  return changed;
}

class KVAdapter {
  async read(env: any): Promise<DatabaseSchema | null> {
    try {
      if (!env) throw new Error("Environment configuration is missing");
      const d1 = env.CABFARE_D1 && typeof env.CABFARE_D1.prepare === 'function' ? env.CABFARE_D1 : null;
      if (d1) {
        const row = await d1.prepare('SELECT state FROM database_state WHERE id = 1').first();
        if (row?.state) return JSON.parse(String(row.state)) as DatabaseSchema;
      }
      const cloudflareKv = env.CABFARE_DB && typeof env.CABFARE_DB.get === 'function'
        ? env.CABFARE_DB
        : null;
      if (cloudflareKv) {
        const storedData = await cloudflareKv.get('cabfare_db', 'json');
        if (storedData) {
          const migrated = storedData as DatabaseSchema;
          if (d1) await d1.prepare('INSERT INTO database_state (id, state, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at').bind(JSON.stringify(migrated), new Date().toISOString()).run();
          return migrated;
        }
      }
      const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
      const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
      
      if (!url || !token) {
        if (cloudflareKv) return null;
        try {
          const savedData = await readFile(localDatabasePath, 'utf8');
          return JSON.parse(savedData) as DatabaseSchema;
        } catch (error: any) {
          if (error?.code !== 'ENOENT') throw error;
          const initialData = createEmptyDatabase();
          await mkdir(path.dirname(localDatabasePath), { recursive: true });
          await writeFile(localDatabasePath, JSON.stringify(initialData, null, 2), 'utf8');
          return initialData;
        }
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(["GET", "cabfare_db"])
      });
      
      if (!res.ok) {
         const errText = await res.text();
         throw new Error(`Upstash API Error: ${res.status} ${res.statusText} - ${errText}`);
      }

      const json: any = await res.json();
      if (json && json.error) {
         throw new Error(`Upstash DB Error: ${json.error}`);
      }
      if (json && json.result) {
        const legacyData = JSON.parse(json.result) as DatabaseSchema;
        if (cloudflareKv) await cloudflareKv.put('cabfare_db', JSON.stringify(legacyData));
        return legacyData;
      }
    } catch (e: any) {
      console.error("KV read error:", e);
      throw new Error(`KV read failed: ${e.message}`);
    }
    return null;
  }

  async write(data: DatabaseSchema, env: any): Promise<void> {
    try {
      if (!env) throw new Error("Environment configuration is missing");
      const d1 = env.CABFARE_D1 && typeof env.CABFARE_D1.prepare === 'function' ? env.CABFARE_D1 : null;
      if (d1) {
        await d1.prepare('INSERT INTO database_state (id, state, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at').bind(JSON.stringify(data), new Date().toISOString()).run();
        return;
      }
      if (env.CABFARE_DB && typeof env.CABFARE_DB.put === 'function') {
        await env.CABFARE_DB.put('cabfare_db', JSON.stringify(data));
        return;
      }
      const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
      const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
      
      if (!url || !token) {
        await mkdir(path.dirname(localDatabasePath), { recursive: true });
        const temporaryPath = `${localDatabasePath}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
        await writeFile(temporaryPath, JSON.stringify(data, null, 2), 'utf8');
        await rename(temporaryPath, localDatabasePath);
        return;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(["SET", "cabfare_db", JSON.stringify(data)])
      });
      
      if (!res.ok) {
         const errText = await res.text();
         throw new Error(`Upstash Write API Error: ${res.status} ${res.statusText} - ${errText}`);
      }
      const json: any = await res.json();
      if (json && json.error) {
         throw new Error(`Upstash Write DB Error: ${json.error}`);
      }
    } catch (e: any) {
      console.error("KV write error:", e);
      throw new Error(`KV write failed: ${e.message}`);
    }
  }
}

export class DB {
  data: DatabaseSchema | null = null;
  adapter = new KVAdapter();
  env: any;
  lastFetchTime = 0;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(env: any) {
    this.env = env;
  }

  async read() {
    await this.writeQueue;
    this.data = await this.adapter.read(this.env);
    this.lastFetchTime = Date.now();
  }

  async write() {
    if (!this.data) return;
    const snapshot = structuredClone(this.data);
    const writeEnvironment = this.env;
    const operation = this.writeQueue.then(() => this.adapter.write(snapshot, writeEnvironment));
    this.writeQueue = operation.catch(() => undefined);
    await operation;
    this.lastFetchTime = Date.now();
  }

  async readBookings(): Promise<any[] | null> {
    if (this.env?.CABFARE_D1 && this.data?.bookings) return this.data.bookings;
    if (this.env?.CABFARE_DB && typeof this.env.CABFARE_DB.get === 'function') {
      const value = await this.env.CABFARE_DB.get('cabfare_bookings', 'json');
      return Array.isArray(value) ? value : null;
    }
    return null;
  }

  async writeBookings(bookings: any[]) {
    if (this.env?.CABFARE_D1) {
      await this.write();
      return;
    }
    if (this.env?.CABFARE_DB && typeof this.env.CABFARE_DB.put === 'function') {
      await this.env.CABFARE_DB.put('cabfare_bookings', JSON.stringify(bookings || []));
    }
  }
}

export function applySupervisorPricingMigration(data: DatabaseSchema) {
  const globalVars = data.globalVars || (data.globalVars = {});
  if (globalVars.pricingModelVersion === 'company-calculation-2026-08-2') return false;
  const vehiclePolicies: Record<string, any> = {
    minibus: { ratePerKm: 0.26, sellingRateOneWay: 1.2, sellingRateReturn: 0.65, minimumHire: 175, includedKmOneWay: 20, includedKmReturn: 40, commercialWeight: 1, standingCostPerDay: 150 },
    bus: { ratePerKm: 0.29, sellingRateOneWay: 1.65, sellingRateReturn: 0.85, minimumHire: 275, includedKmOneWay: 20, includedKmReturn: 50, commercialWeight: 1.08, standingCostPerDay: 200 },
    coach: { ratePerKm: 0.79, sellingRateOneWay: 2.2, sellingRateReturn: 1, minimumHire: 450, includedKmOneWay: 0, includedKmReturn: 75, commercialWeight: 1.12, standingCostPerDay: 260 }
  };
  data.vehicles = (data.vehicles || []).map(vehicle => ({ ...vehicle, ...(vehiclePolicies[vehicle.id] || {}) }));
  Object.assign(globalVars, {
    pricingModelVersion: 'company-calculation-2026-08-2',
    driverWageWeekday: 15,
    driverWageWeekend: 20,
    driverWageHoliday: 22,
    marginWeekday: 20,
    marginWeekend: 25,
    marginHoliday: 30,
    overnightCost: 200,
    emptyLegThresholdKm: 20,
    dualDriverThresholdHours: 9,
    waitingWageFactor: 0.75,
    customerRangePct: 12,
    yardAddress: 'Unit 1, Carolean Coaches, Bentley Lane, Walsall WS2 8TL, UK',
    yardLat: 52.5842,
    yardLng: -1.9873
  });
  data.routeTemplates ||= [];
  data.routeTemplates = data.routeTemplates.filter(route => !route.id.startsWith('company-'));
  data.pricingMatrix = (data.pricingMatrix || []).map(rule => ({ ...rule, status: 'inactive' as const }));
  return true;
}

let db: DB | null = null;

export async function initDatabase(env: any): Promise<DB> {
  if (db) return db;

  db = new DB(env);
  await db.read();

  if (!db.data || Object.keys(db.data).length === 0) {
    db.data = createEmptyDatabase();
    applySupervisorPricingMigration(db.data);
    await db.write();
  } else if (applySupervisorPricingMigration(db.data) || normalizeAccessData(db.data) || normalizeVehicleCostAliases(db.data)) {
    await db.write();
  }

  return db;
}

export async function getDatabase(env: any): Promise<DB> {
  if (!db) {
    await initDatabase(env);
  } else {
    
    db.env = env;
    
    
    if (Date.now() - db.lastFetchTime > 2000) {
      await db.read();
      if (db.data && normalizeVehicleCostAliases(db.data)) await db.write();
    }
  }
  return db!;
}

export function addActivity(db: DB, type: string, message: string, actor?: any, changes?: any[]) {
  if (!db.data) return;
  if (!Array.isArray(db.data.activityLog)) db.data.activityLog = [];
  db.data.activityLog.unshift({
    id: `activity_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    message,
    createdAt: new Date().toISOString(),
    actorId: actor?.id,
    actorName: actor?.name || actor?.email,
    changes: Array.isArray(changes) && changes.length ? changes.slice(0, 20) : undefined
  });
}
