import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAvailabilityFromData } from '../src/engines/availabilityEngine';

function availabilityData() {
  return {
    vehicles: [
      { id: 'minibus', capacity: 16, fleetCount: 3 },
      { id: 'coach', capacity: 50, fleetCount: 1 }
    ],
    vehicleAvailability: [],
    blockedDates: []
  } as any;
}

const baseInput = {
  vehicleId: 'minibus',
  passengers: 16,
  departureDate: '2026-08-10T09:00:00.000Z',
  returnDate: '2026-08-10T17:00:00.000Z'
};

test('availability accepts a valid request when enough fleet units are free', () => {
  assert.equal(checkAvailabilityFromData(baseInput, availabilityData()), true);
});

test('availability calculates the number of vehicles required by passenger capacity', () => {
  const data = availabilityData();

  assert.equal(checkAvailabilityFromData({ ...baseInput, passengers: 48 }, data), true);
  assert.equal(checkAvailabilityFromData({ ...baseInput, passengers: 49 }, data), false);
});

test('availability subtracts all overlapping blocked fleet units', () => {
  const data = availabilityData();
  data.vehicleAvailability.push({
    id: 'maintenance',
    vehicleId: 'minibus',
    from: '2026-08-09T00:00:00.000Z',
    to: '2026-08-11T00:00:00.000Z',
    units: 1
  });
  data.blockedDates.push({
    id: 'private-hire',
    vehicleId: 'minibus',
    from: '2026-08-10T08:00:00.000Z',
    to: '2026-08-10T18:00:00.000Z',
    units: 1
  });

  assert.equal(checkAvailabilityFromData({ ...baseInput, passengers: 16 }, data), true);
  assert.equal(checkAvailabilityFromData({ ...baseInput, passengers: 17 }, data), false);
});

test('availability ignores blocks for other vehicles and non-overlapping dates', () => {
  const data = availabilityData();
  data.vehicleAvailability.push(
    {
      id: 'other-vehicle',
      vehicleId: 'coach',
      from: '2026-08-10T00:00:00.000Z',
      to: '2026-08-11T00:00:00.000Z',
      units: 1
    },
    {
      id: 'past',
      vehicleId: 'minibus',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-02T00:00:00.000Z',
      units: 3
    }
  );

  assert.equal(checkAvailabilityFromData({ ...baseInput, passengers: 48 }, data), true);
});

test('availability rejects unknown vehicles and invalid date ranges', () => {
  const data = availabilityData();

  assert.equal(checkAvailabilityFromData({ ...baseInput, vehicleId: 'missing' }, data), false);
  assert.equal(checkAvailabilityFromData({ ...baseInput, departureDate: 'not-a-date' }, data), false);
  assert.equal(checkAvailabilityFromData({
    ...baseInput,
    departureDate: '2026-08-11T09:00:00.000Z',
    returnDate: '2026-08-10T09:00:00.000Z'
  }, data), false);
});
