import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_PERMISSIONS, can, issueAccessToken, permissionsFor } from '../src/services/access';
import { inviteHandler } from '../src/controllers/admin_staffController';
import { recordDailyUsage, recordSessionTime } from '../src/services/user';

test('staff roles expose only their configured areas and issue expiring one-time credentials', () => {
  assert.deepEqual(permissionsFor({ role: 'quotes', permissions: [] }), ['bookings']);
  assert.equal(can({ role: 'admin', permissions: [] }, 'staff'), false);
  assert.equal(can({ role: 'owner', permissions: [] }, 'staff'), true);
  assert.deepEqual(permissionsFor({ role: 'custom', permissions: ['pricing', 'invalid'] }), ['pricing']);
  assert.deepEqual(permissionsFor({ role: 'custom', permissions: ['quotes'] }), ['bookings']);

  const user: any = {};
  const issued = issueAccessToken(user, 'reset');
  assert.equal(issued.token.length, 64);
  assert.equal(typeof user.resetTokenHash, 'string');
  assert.notEqual(user.resetTokenHash, issued.token);
  assert.ok(new Date(issued.expiresAt).getTime() > Date.now());
  assert.ok(ALL_PERMISSIONS.includes('staff'));
});

test('session seconds accumulate and stop without replacing previous minutes', () => {
  const user: any = { usageMinutes: 12, usageSeconds: 8, sessionStartedAt: '2026-08-12T10:00:00Z', sessionLastSeenAt: '2026-08-12T10:00:00Z' };
  recordSessionTime(user, new Date('2026-08-12T10:00:07Z'), true);
  assert.equal(user.usageMinutes, 12);
  assert.equal(user.usageSeconds, 15);
  assert.equal(user.sessionStartedAt, undefined);
});

test('usage and logins are stored per day', () => {
  const user: any = {};
  const now = new Date('2026-08-12T10:00:00Z');
  recordDailyUsage(user, now, 2, true);
  const daily: any = Object.values(user.usageByDate)[0];
  assert.equal(daily.logins, 1);
  assert.equal(daily.minutes, 2);
});

test('submitting an existing pending email resends its invitation instead of rejecting it', async () => {
  let stored: any = {
    users: [], pricingMatrix: [], routeTemplates: [], seasonalPricing: [], mileageRules: [], bookings: [], quotes: [],
    waitingCharges: [], vehicleAvailability: [], routeCache: [], vehicles: [], globalVars: { pricingModelVersion: 'company-calculation-2026-08-2' }, activityLog: []
  };
  const env = { CABFARE_DB: { get: async () => structuredClone(stored), put: async (_key: string, value: string) => { stored = JSON.parse(value); } } };
  const responses: any[] = [];
  const res: any = { status(code: number) { responses.push({ code }); return this; }, json(payload: any) { responses.at(-1).payload = payload; return payload; } };
  const req: any = { env, adminUser: { id: 'owner', name: 'Owner' }, body: { name: 'New Staff', email: 'staff@example.com', role: 'quotes', baseUrl: 'https://admin.example.com' } };

  responses.push({ code: 201 }); await inviteHandler(req, res);
  responses.push({ code: 200 }); await inviteHandler(req, res);

  assert.equal(stored.users.length, 1);
  assert.equal(responses.at(-1).code, 200);
  assert.match(responses.at(-1).payload.link, /access=invite/);
});
