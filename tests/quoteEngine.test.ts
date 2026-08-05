import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTotalWaitingMinutes } from '../src/engines/quoteEngine';

test('journey waiting includes configured time at every intermediate stop', () => {
  assert.equal(calculateTotalWaitingMinutes({
    waitingMins: 30,
    stops: [{ wait: 15 }, { wait: '20' }, { wait: -10 }]
  }), 65);
});

test('journey waiting safely handles missing stop data', () => {
  assert.equal(calculateTotalWaitingMinutes({}), 0);
});
