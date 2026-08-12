import assert from 'node:assert/strict';
import test from 'node:test';
import { DB, applySupervisorPricingMigration } from '../src/database/db';

test('database writes are serialized and preserve the newest snapshot', async () => {
  const database = new DB({});
  const writes: any[] = [];
  let activeWrites = 0;
  let maximumConcurrentWrites = 0;

  (database as any).adapter = {
    read: async () => null,
    write: async (data: any) => {
      activeWrites += 1;
      maximumConcurrentWrites = Math.max(maximumConcurrentWrites, activeWrites);
      await new Promise(resolve => setTimeout(resolve, 10));
      writes.push(data);
      activeWrites -= 1;
    }
  };

  database.data = { version: 1 } as any;
  const firstWrite = database.write();
  database.data = { version: 2 } as any;
  const secondWrite = database.write();
  await Promise.all([firstWrite, secondWrite]);

  assert.equal(maximumConcurrentWrites, 1);
  assert.deepEqual(writes.map(write => write.version), [1, 2]);
});

test('Cloudflare KV is used as persistent database storage', async () => {
  const values = new Map<string, string>();
  const namespace = {
    get: async (key: string, type?: string) => {
      const value = values.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string) => { values.set(key, value); }
  };
  const database = new DB({ CABFARE_DB: namespace });
  database.data = { bookings: [{ id: 'BK-PERSISTED' }] } as any;
  await database.write();

  const reloaded = new DB({ CABFARE_DB: namespace });
  await reloaded.read();
  assert.equal(reloaded.data?.bookings?.[0]?.id, 'BK-PERSISTED');
});

test('supervisor pricing migration preserves operational records', () => {
  const data: any = {
    users: [{ id: 'user-1' }], bookings: [{ id: 'booking-1' }], quotes: [{ id: 'quote-1' }],
    vehicles: [{ id: 'coach', name: 'Premium Coach' }],
    pricingMatrix: [{ id: 'legacy', status: 'active' }], globalVars: {}
  };
  assert.equal(applySupervisorPricingMigration(data), true);
  assert.deepEqual(data.users, [{ id: 'user-1' }]);
  assert.deepEqual(data.bookings, [{ id: 'booking-1' }]);
  assert.deepEqual(data.quotes, [{ id: 'quote-1' }]);
  assert.equal(data.vehicles[0].ratePerKm, 0.79);
  assert.equal(data.vehicles[0].minimumHire, 450);
  assert.equal(data.routeTemplates.some((route: any) => route.id.startsWith('company-')), false);
  assert.equal(data.pricingMatrix[0].status, 'inactive');
  assert.equal(applySupervisorPricingMigration(data), false);
});
