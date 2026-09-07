
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import seedData from './seed.json';

// Kept relative so Cloudflare can validate the Worker bundle. This path is
// touched only by the local-file fallback; production uses CABFARE_DB KV.
const localDatabasePath = '.data/db.json';
const D1_STATE_TIMEOUT_MS = 30_000;

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
    fareCalculationMethod?: 'commercial' | 'cost-plus';
    
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
    fuelUnit?: 'litres' | 'gallons';
    fuelPricePerLitre?: number;
    driverHourlyWage?: number;
    holidayPayPct?: number;
    profitMarginPct?: number;
    netMarginPct?: number;
    vatPct?: number;
    netProfitTarget?: number;
    extraLuggageProfitPct?: number;
    emptyLegThresholdKm?: number;
  dualDriverThresholdHours?: number;
  drivingBreakTriggerHours?: number;
  drivingBreakMinutes?: number;
    dailyDrivingLimitEnabled?: boolean;
    drivingBreakTriggerEnabled?: boolean;
    drivingBreakDurationEnabled?: boolean;
    waitingWageFactor?: number;
    customerRangePct?: number;
    customerRangeUpliftEnabled?: boolean;
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

const ALL_TOP_LEVEL_SECTIONS: (keyof DatabaseSchema | 'googleApiKey')[] = [
  'users', 'pricingMatrix', 'routeTemplates', 'seasonalPricing', 'mileageRules',
  'bookings', 'quotes', 'waitingCharges', 'vehicleAvailability', 'routeCache',
  'vehicles', 'globalVars', 'surcharges', 'annualOverheads', 'blockedDates',
  'googleApiKey', 'operatorDetails', 'activityLog'
];

export const CONFIG_SECTION_KEYS: (keyof DatabaseSchema)[] = [
  'vehicles', 'globalVars', 'surcharges', 'annualOverheads', 'blockedDates', 'operatorDetails'
];

class KVAdapter {
  async read(env: any, includeBookings: boolean = false): Promise<DatabaseSchema | null> {
    try {
      if (!env) throw new Error("Environment configuration is missing");
      const d1 = env.CABFARE_D1 && typeof env.CABFARE_D1.prepare === 'function' ? env.CABFARE_D1 : null;
      const fastKv = !d1 && env.CABFARE_DB && typeof env.CABFARE_DB.get === 'function' ? env.CABFARE_DB : null;
      if (fastKv) {
        try {
          const storedData = await Promise.race([
            fastKv.get('cabfare_db', 'json'),
            new Promise<null>((_, reject) => setTimeout(() => reject(new Error('KV read timed out')), 5000))
          ]);
          if (storedData) return storedData as DatabaseSchema;
        } catch (error) {
          console.warn('KV read unavailable; trying D1 fallback:', error);
        }
      }
      if (d1) {
        // D1 sections are authoritative. Never recover an old snapshot on a read failure.
        try {
          const query = includeBookings
            ? 'SELECT section_key, data FROM app_sections'
            : "SELECT section_key, data FROM app_sections WHERE section_key != 'bookings'";
          const rowsResult = await Promise.race([
            d1.prepare(query).all(),
            new Promise<null>((_, reject) => setTimeout(() => reject(new Error('D1 app_sections read timed out')), 5000))
          ]);
          const rows = rowsResult?.results;
          if (Array.isArray(rows) && rows.length > 0) {
            const reconstructed: any = { bookings: [] };
            for (const row of rows) {
              reconstructed[row.section_key] = JSON.parse(String(row.data));
            }
            if (CONFIG_SECTION_KEYS.some(key => reconstructed[key] == null)) {
              throw new Error('Saved configuration is incomplete; automatic defaults are disabled');
            }
            return reconstructed as DatabaseSchema;
          }
        } catch (splitError) {
          throw splitError;
        }

        throw new Error('Saved D1 sections are unavailable; automatic recovery is disabled');
      }
      const cloudflareKv = env.CABFARE_DB && typeof env.CABFARE_DB.get === 'function'
        ? env.CABFARE_DB
        : null;
      if (cloudflareKv) {
        const storedData = await cloudflareKv.get('cabfare_db', 'json');
        if (storedData) {
          const migrated = storedData as DatabaseSchema;
          if (d1) d1.prepare('INSERT INTO database_state (id, state, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at').bind(JSON.stringify(migrated), new Date().toISOString()).run().catch(() => {});
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

  async writeSections(sections: Partial<DatabaseSchema>, env: any): Promise<void> {
    const d1 = env?.CABFARE_D1 && typeof env.CABFARE_D1.prepare === 'function' ? env.CABFARE_D1 : null;
    const now = new Date().toISOString();
    if (d1) {
      const statements: any[] = [];
      for (const [key, value] of Object.entries(sections)) {
        if (value === undefined) continue;
        statements.push(
          d1.prepare('INSERT INTO app_sections (section_key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(section_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
            .bind(key, JSON.stringify(value), now)
        );
      }
      if (statements.length > 0) {
        await Promise.race([
          d1.batch(statements),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('D1 writeSections timed out')), D1_STATE_TIMEOUT_MS))
        ]);
        return;
      }
    }
    // Fallback: write via full write method
    const full = await this.read(env, true);
    if (!full) throw new Error('Cannot save without reading the current database');
    Object.assign(full, sections);
    await this.write(full, env);
  }

  async write(data: DatabaseSchema, env: any): Promise<void> {
    try {
      if (!env) throw new Error("Environment configuration is missing");
      const d1 = env.CABFARE_D1 && typeof env.CABFARE_D1.prepare === 'function' ? env.CABFARE_D1 : null;
      if (d1) {
        const now = new Date().toISOString();
        const statements: any[] = [];
        for (const key of ALL_TOP_LEVEL_SECTIONS) {
          const val = (data as any)[key];
          if (val !== undefined) {
            statements.push(
              d1.prepare('INSERT INTO app_sections (section_key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(section_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
                .bind(key, JSON.stringify(val), now)
            );
          }
        }
        if (statements.length > 0) {
          await Promise.race([
            d1.batch(statements),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('D1 write timed out')), D1_STATE_TIMEOUT_MS))
          ]);
          return;
        }
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
  private persistedData: DatabaseSchema | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(env: any) {
    this.env = env;
  }

  async read(includeBookings: boolean = false) {
    const existingBookings = this.data?.bookings;
    const fresh = await this.adapter.read(this.env, includeBookings);
    if (fresh) {
      this.persistedData = structuredClone(fresh);
      if (!includeBookings && Array.isArray(existingBookings) && existingBookings.length > 0) {
        fresh.bookings = existingBookings;
      }
      this.data = fresh;
      this.lastFetchTime = Date.now();
    }
  }

  async write() {
    if (!this.data) return;
    const snapshot = structuredClone(this.data);
    const latest = await this.adapter.read(this.env).catch(() => null);
    if (latest) {
      // Configuration writes must never replace bookings or quotes created by
      // a concurrent request with an older in-memory snapshot.
      snapshot.bookings = structuredClone(latest.bookings || snapshot.bookings || []);
      snapshot.quotes = structuredClone(latest.quotes || snapshot.quotes || []);
    }
    const writeEnvironment = this.env;
    const operation = this.writeQueue.then(() => this.adapter.write(snapshot, writeEnvironment));
    this.writeQueue = operation.catch(() => undefined);
    await operation;
    this.lastFetchTime = Date.now();
  }

  async writeSections(sections: Partial<DatabaseSchema>, checkConfiguration = false) {
    if (checkConfiguration && this.env?.CABFARE_D1) {
      const entries = Object.entries(sections).filter(([, value]) => value !== undefined);
      const values = JSON.stringify(Object.fromEntries(entries.map(([key, value]) => [key, JSON.stringify(value)])));
      const expected = JSON.stringify(Object.fromEntries(entries
        .filter(([key]) => CONFIG_SECTION_KEYS.includes(key as keyof DatabaseSchema))
        .map(([key]) => [key, JSON.stringify((this.persistedData as any)?.[key])])));
      const result = await this.env.CABFARE_D1.prepare(
        "UPDATE app_sections SET data = (SELECT value FROM json_each(?) WHERE key = section_key), updated_at = ? WHERE section_key IN (SELECT key FROM json_each(?)) AND NOT EXISTS (SELECT 1 FROM json_each(?) AS expected LEFT JOIN app_sections AS current ON current.section_key = expected.key WHERE current.data IS NULL OR json(current.data) != json(expected.value))"
      ).bind(values, new Date().toISOString(), values, expected).run();
      if (result.meta?.changes !== entries.length) throw new Error('Configuration changed during this save. Refresh before editing again.');
      return;
    }
    if (!this.data) {
      this.data = createEmptyDatabase();
    }
    Object.assign(this.data, sections);
    const sectionsToSave = structuredClone(sections);
    const writeEnvironment = this.env;
    const operation = this.writeQueue.then(() => this.adapter.writeSections(sectionsToSave, writeEnvironment));
    this.writeQueue = operation.catch(() => undefined);
    await operation;
    this.lastFetchTime = Date.now();
  }

  async readBookings(): Promise<any[] | null> {
    if (this.env?.CABFARE_D1 && typeof this.env.CABFARE_D1.prepare === 'function') {
      const row = await Promise.race([
        this.env.CABFARE_D1.prepare("SELECT data FROM app_sections WHERE section_key = 'bookings'").first(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('D1 bookings read timed out')), D1_STATE_TIMEOUT_MS))
      ]);
      if (!row?.data) throw new Error('Saved bookings are unavailable; automatic recovery is disabled');
      const bookings = JSON.parse(String(row.data));
      if (!Array.isArray(bookings)) throw new Error('Saved bookings are invalid');
      return bookings;
    }
    if (!this.env?.CABFARE_D1 && this.env?.CABFARE_DB && typeof this.env.CABFARE_DB.get === 'function') {
      try {
        const value = await this.env.CABFARE_DB.get('cabfare_bookings', 'json');
        if (Array.isArray(value)) return value;
      } catch (error) {
        console.warn('KV bookings read unavailable:', error);
      }
    }
    return Array.isArray(this.data?.bookings) ? this.data.bookings : null;
  }

  async readUsers(): Promise<User[] | null> {
    if (this.env?.CABFARE_D1 && typeof this.env.CABFARE_D1.prepare === 'function') {
      try {
        const splitRow = await Promise.race([
          this.env.CABFARE_D1.prepare("SELECT data FROM app_sections WHERE section_key = 'users'").first(),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error('D1 users split read timed out')), 5000))
        ]);
        if (splitRow?.data) {
          const users = typeof splitRow.data === 'string' ? JSON.parse(splitRow.data) : splitRow.data;
          if (Array.isArray(users)) return users as User[];
        }
      } catch (splitError) {
        console.warn('D1 app_sections users read unavailable; trying fallback:', splitError);
      }
      const row = await Promise.race([
        this.env.CABFARE_D1.prepare("SELECT json_extract(state, '$.users') AS users FROM database_state WHERE id = 1").first(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('D1 users read timed out')), 5000))
      ]);
      if (row?.users) {
        const users = typeof row.users === 'string' ? JSON.parse(row.users) : row.users;
        return Array.isArray(users) ? users as User[] : [];
      }
      return [];
    }
    return Array.isArray(this.data?.users) ? this.data.users : null;
  }

  async updateVehicleFareMethod(id: string, method: 'commercial' | 'cost-plus'): Promise<boolean> {
    const d1 = this.env?.CABFARE_D1;
    if (!d1 || typeof d1.prepare !== 'function') return false;
    const now = new Date().toISOString();
    // Try updating in app_sections first
    try {
      const row = await d1.prepare(
        "SELECT json_each.key AS vehicle_index FROM app_sections, json_each(data) WHERE section_key = 'vehicles' AND json_extract(json_each.value, '$.id') = ?"
      ).bind(id).first();
      if (row) {
        await d1.prepare(
          "UPDATE app_sections SET data = json_set(data, '$[' || ? || '].fareCalculationMethod', ?), updated_at = ? WHERE section_key = 'vehicles'"
        ).bind(String(row.vehicle_index), method, now).run();
        // Update in-memory data if loaded
        if (this.data?.vehicles) {
          const v = this.data.vehicles.find((item: any) => item.id === id);
          if (v) v.fareCalculationMethod = method;
        }
        return true;
      }
    } catch (splitError) {
      console.warn('updateVehicleFareMethod app_sections failed; trying database_state fallback:', splitError);
    }
    // Fallback: update in database_state
    const fallbackRow = await d1.prepare(
      "SELECT json_each.key AS vehicle_index FROM database_state, json_each(json_extract(state, '$.vehicles')) WHERE database_state.id = 1 AND json_extract(json_each.value, '$.id') = ?"
    ).bind(id).first();
    if (!fallbackRow) return false;
    await d1.prepare(
      "UPDATE database_state SET state = json_set(state, '$.vehicles[' || ? || '].fareCalculationMethod', ?), updated_at = ? WHERE id = 1"
    ).bind(String(fallbackRow.vehicle_index), method, now).run();
    return true;
  }

  async writeBookings(bookings: any[], expectedBookings?: any[]) {
    if (this.env?.CABFARE_D1) {
      if (!Array.isArray(expectedBookings)) throw new Error('A fresh bookings snapshot is required');
      const result = await this.env.CABFARE_D1.prepare(
        "UPDATE app_sections SET data = ?, updated_at = ? WHERE section_key = 'bookings' AND json(data) = json(?)"
      ).bind(JSON.stringify(bookings), new Date().toISOString(), JSON.stringify(expectedBookings)).run();
      if (result.meta?.changes !== 1) throw new Error('Bookings changed during this save. Please retry; no records were overwritten.');
      if (this.data) this.data.bookings = structuredClone(bookings);
      return;
    }
    if (!this.data) {
      this.data = createEmptyDatabase();
    }
    this.data.bookings = structuredClone(bookings || []);
    const sectionsToSave = { bookings: structuredClone(bookings || []) };
    const writeEnvironment = this.env;
    const operation = this.writeQueue.then(async () => {
      await this.adapter.writeSections(sectionsToSave, writeEnvironment);
      if (writeEnvironment?.CABFARE_D1 && typeof writeEnvironment.CABFARE_D1.prepare === 'function') {
        try {
          await writeEnvironment.CABFARE_D1.prepare(
            "UPDATE database_state SET state = json_set(state, '$.bookings', json(?)), updated_at = ? WHERE id = 1"
          ).bind(JSON.stringify(bookings || []), new Date().toISOString()).run();
        } catch (backupError) {
          console.warn('Failed to update database_state backup for bookings:', backupError);
        }
      }
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
    this.lastFetchTime = Date.now();
    if (!this.env?.CABFARE_D1 && this.env?.CABFARE_DB && typeof this.env.CABFARE_DB.put === 'function') {
      try {
        await this.env.CABFARE_DB.put('cabfare_bookings', JSON.stringify(bookings || []));
      } catch (e) {
        console.error('KV writeBookings error:', e);
      }
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

export async function initDatabase(env: any): Promise<DB> {
  const database = new DB(env);
  await database.read();
  if (!database.data || Object.keys(database.data).length === 0) {
    throw new Error('Saved database is unavailable; automatic seeding is disabled');
  }
  // Normalize compatibility aliases in memory only. Reads must never rewrite saved data.
  normalizeAccessData(database.data);
  normalizeVehicleCostAliases(database.data);
  return database;
}

export async function getDatabase(env: any): Promise<DB> {
  return initDatabase(env);
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
