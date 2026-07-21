// No fs, path, or Node.js built-ins.
import seedData from './seed.json';

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
  vehicles?: any[];
  globalVars?: any;
  surcharges?: any;
  annualOverheads?: any[];
  blockedDates?: any[];
}

class KVAdapter {
  async read(env: any): Promise<DatabaseSchema | null> {
    try {
      if (!env) throw new Error("Environment configuration is missing");
      const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
      const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
      if (!url || !token) throw new Error("Upstash Redis credentials missing in environment");

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
      if (!url || !token) throw new Error("Upstash Redis credentials missing in environment");

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

  constructor(env: any) {
    this.env = env;
  }

  async read() {
    this.data = await this.adapter.read(this.env);
  }

  async write() {
    if (this.data) {
      await this.adapter.write(this.data, this.env);
    }
  }
}

let db: DB | null = null;

export async function initDatabase(env: any): Promise<DB> {
  if (db) return db;

  db = new DB(env);
  await db.read();

  if (!db.data || Object.keys(db.data).length === 0) {
    db.data = seedData as any as DatabaseSchema;
    await db.write();
  }

  return db;
}

export async function getDatabase(env: any): Promise<DB> {
  if (!db) {
    await initDatabase(env);
  } else {
    // Keep it refreshed just in case but update env reference
    db.env = env;
    await db.read();
  }
  return db!;
}
