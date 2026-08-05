import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardMetrics } from '../src/controllers/admin_dashboardController';

const emptyDatabase = {
  users: [], pricingMatrix: [], routeTemplates: [], seasonalPricing: [],
  mileageRules: [], bookings: [], quotes: [], waitingCharges: [],
  vehicleAvailability: [], routeCache: [], blockedDates: [], activityLog: []
};

test('dashboard exposes persisted bookings across the twelve-month view', () => {
  const data: any = {
    ...emptyDatabase,
    vehicles: [{ id: 'coach', name: 'Coach', capacity: 50, fleetCount: 2 }],
    bookings: [{
      id: 'BK-1',
      createdAt: '2026-06-01T09:00:00Z',
      journey: { departureDate: '2026-06-15T12:00:00Z', passengers: 40 },
      quote: { vehicle: { id: 'coach' }, result: { finalPrice: 1250 } }
    }]
  };

  const result = buildDashboardMetrics(data, new Date('2026-08-05T12:00:00Z'));
  const june = result.activity.monthly.find(bucket => bucket.month === '2026-06');

  assert.equal(result.totals.bookings, 1);
  assert.equal(result.totals.pendingBookings, 1);
  assert.equal(result.totals.quotedValue, 1250);
  assert.equal(june?.bookingCount, 1);
  assert.equal(june?.quotedValue, 1250);
  assert.equal(result.recentBookings[0]?.id, 'BK-1');
});

test('dashboard calculates configured fleet availability from backend data', () => {
  const data: any = {
    ...emptyDatabase,
    vehicles: [{ id: 'bus', name: 'Bus', capacity: 30, fleetCount: 3 }],
    blockedDates: [{
      id: 'block-1', vehicleId: 'bus', from: '2026-08-05', to: '2026-08-05', units: 1, reason: 'Maintenance'
    }]
  };

  const result = buildDashboardMetrics(data, new Date('2026-08-05T12:00:00Z'));
  assert.equal(result.totals.configuredFleetUnits, 3);
  assert.equal(result.totals.blockedFleetUnits, 1);
  assert.equal(result.totals.availableFleetUnits, 2);
});
