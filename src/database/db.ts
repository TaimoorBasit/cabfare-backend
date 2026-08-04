
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const localDatabasePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.data/db.json'
);

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: string;
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
    extraLuggageProfitPct?: number;
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
  }[];
}

function createEmptyDatabase(): DatabaseSchema {
  return {
    users: [],
    pricingMatrix: [],
    routeTemplates: [],
    seasonalPricing: [],
    mileageRules: [],
    bookings: [],
    quotes: [],
    waitingCharges: [],
    vehicleAvailability: [],
    routeCache: [],
    vehicles: [],
    globalVars: {},
    operatorDetails: {},
    surcharges: {},
    annualOverheads: [],
    blockedDates: [],
    activityLog: []
  };
}

class KVAdapter {
  async read(env: any): Promise<DatabaseSchema | null> {
    try {
      if (!env) throw new Error("Environment configuration is missing");
      const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
      const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
      
      if (!url || !token) {
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
        return JSON.parse(json.result);
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
      const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
      const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
      
      if (!url || !token) {
        await mkdir(path.dirname(localDatabasePath), { recursive: true });
        const temporaryPath = `${localDatabasePath}.tmp`;
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

class DB {
  data: DatabaseSchema | null = null;
  adapter = new KVAdapter();
  env: any;
  lastFetchTime = 0;

  constructor(env: any) {
    this.env = env;
  }

  async read() {
    this.data = await this.adapter.read(this.env);
    this.lastFetchTime = Date.now();
  }

  async write() {
    if (this.data) {
      await this.adapter.write(this.data, this.env);
      this.lastFetchTime = Date.now();
    }
  }
}

let db: DB | null = null;

export async function initDatabase(env: any): Promise<DB> {
  if (db) return db;

  db = new DB(env);
  await db.read();

  if (!db.data || Object.keys(db.data).length === 0) {
    db.data = createEmptyDatabase();
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
    }
  }
  return db!;
}

export function addActivity(db: DB, type: string, message: string) {
  if (!db.data) return;
  if (!Array.isArray(db.data.activityLog)) db.data.activityLog = [];
  db.data.activityLog.unshift({
    id: `activity_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    message,
    createdAt: new Date().toISOString()
  });
  db.data.activityLog = db.data.activityLog.slice(0, 100);
}
