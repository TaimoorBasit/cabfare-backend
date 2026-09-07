import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { DB, applySupervisorPricingMigration, initDatabase } from '../src/database/db';

test('configuration updates are atomic and preserve newer settings and bookings', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE app_sections (section_key TEXT PRIMARY KEY, data TEXT, updated_at TEXT)');
  const seed: any = { vehicles: [], globalVars: { marginWeekday: 37 }, surcharges: {}, annualOverheads: [], blockedDates: [], operatorDetails: {}, bookings: [{ id: 'NEW' }], activityLog: [] };
  for (const [key, value] of Object.entries(seed)) sql.prepare('INSERT INTO app_sections VALUES (?, ?, ?)').run(key, JSON.stringify(value), 'initial');
  const env = { CABFARE_D1: { prepare: (query: string) => ({
    all: async () => ({ results: sql.prepare(query).all() }),
    first: async () => sql.prepare(query).get(),
    bind: (...args: any[]) => ({ run: async () => ({ meta: sql.prepare(query).run(...args) }) })
  }) } };
  try {
    const first = await initDatabase(env);
    const stale = await initDatabase(env);
    await first.writeSections({ globalVars: { marginWeekday: 41 }, surcharges: { toll: 7 } }, true);
    await assert.rejects(stale.writeSections({ globalVars: { marginWeekday: 10 }, surcharges: { toll: 99 } }, true), /changed during this save/);
    const fresh = await initDatabase(env);
    assert.equal(fresh.data?.globalVars?.marginWeekday, 41);
    assert.deepEqual(fresh.data?.surcharges, { toll: 7 });
    assert.deepEqual(await fresh.readBookings(), [{ id: 'NEW' }]);
    await fresh.writeBookings([{ id: 'NEW' }, { id: 'NEWER' }], [{ id: 'NEW' }]);
    await assert.rejects(stale.writeBookings([], [{ id: 'NEW' }]), /changed during this save/);
    assert.deepEqual(await fresh.readBookings(), [{ id: 'NEW' }, { id: 'NEWER' }]);
  } finally { sql.close(); }
});

test('startup preserves saved custom values without seeding or migrating', async () => {
  const saved = { users: [], vehicles: [{ id: 'coach', ratePerKm: 9.87 }], globalVars: { marginWeekday: 37 }, bookings: [] };
  let writes = 0;
  const env = { CABFARE_DB: { get: async () => structuredClone(saved), put: async () => { writes++; } } };
  const first = await initDatabase(env);
  assert.deepEqual(first.data, saved);
  saved.globalVars.marginWeekday = 41;
  const fresh = await initDatabase(env);
  assert.equal(fresh.data?.globalVars?.marginWeekday, 41);
  assert.equal(writes, 0);
});

test('D1 read errors and missing sections never load legacy snapshots or seed data', async () => {
  for (const fail of [true, false]) {
    const queries: string[] = [];
    const database = new DB({ CABFARE_D1: { prepare: (sql: string) => {
      queries.push(sql);
      return { all: async () => { if (fail) throw new Error('offline'); return { results: [] }; } };
    } } });
    await assert.rejects(database.read());
    assert.equal(database.data, null);
    assert.equal(queries.length, 1);
    assert.ok(queries[0].includes('app_sections'));
  }
});

test('empty saved bookings stay empty and failed reads never return cached bookings', async () => {
  let fail = false;
  const database = new DB({ CABFARE_D1: { prepare: (sql: string) => {
    assert.ok(sql.includes('app_sections'));
    return { first: async () => { if (fail) throw new Error('offline'); return { data: '[]' }; } };
  } } });
  database.data = { bookings: [{ id: 'OLD' }] } as any;
  assert.deepEqual(await database.readBookings(), []);
  fail = true;
  await assert.rejects(database.readBookings(), /offline/);
});

test('booking saves reject a concurrent change without replacing any records', async () => {
  const database = new DB({ CABFARE_D1: { prepare: (sql: string) => {
    assert.match(sql, /AND json\(data\) = json\(\?\)/);
    return { bind: () => ({ run: async () => ({ meta: { changes: 0 } }) }) };
  } } });
  await assert.rejects(database.writeBookings([{ id: 'OLD' }], []), /changed during this save/);
});

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
