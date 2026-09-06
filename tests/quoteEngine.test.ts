import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTotalWaitingMinutes, matchesVehiclePreference } from '../src/engines/quoteEngine';

test('journey waiting includes configured time at every intermediate stop', () => {
  assert.equal(calculateTotalWaitingMinutes({
    waitingMins: 30,
    stops: [{ wait: 15 }, { wait: '20' }, { wait: -10 }]
  }), 65);
});

test('journey waiting safely handles missing stop data', () => {
  assert.equal(calculateTotalWaitingMinutes({}), 0);
});

test('matchesVehiclePreference distinguishes bus from minibus and does not substring match', () => {
  const minibus = { id: 'minibus', name: 'Executive Minibus' };
  const bus = { id: 'bus', name: 'Standard Bus' };
  const coach = { id: 'coach', name: 'Premium Coach (49 Seats)' };

  // 'bus' preference matches only standard bus, never minibus
  assert.equal(matchesVehiclePreference(bus, 'bus'), true);
  assert.equal(matchesVehiclePreference(minibus, 'bus'), false);
  assert.equal(matchesVehiclePreference(coach, 'bus'), false);

  // 'minibus' preference matches only minibus
  assert.equal(matchesVehiclePreference(minibus, 'minibus'), true);
  assert.equal(matchesVehiclePreference(bus, 'minibus'), false);

  // 'coach' preference matches only coach
  assert.equal(matchesVehiclePreference(coach, 'coach'), true);
  assert.equal(matchesVehiclePreference(bus, 'coach'), false);
});

