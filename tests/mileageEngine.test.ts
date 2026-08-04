import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMileage, getDirections } from '../src/engines/mileageEngine';

test('directions fails before making a request when the Maps API key is missing', async () => {
  await assert.rejects(
    getDirections('Alpha', 'Beta', [], ''),
    /Google Maps API key is required/
  );
});

test('directions rejects Google HTTP and route-status failures', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async () => new Response('unavailable', { status: 503, statusText: 'Unavailable' });
  await assert.rejects(getDirections('Alpha', 'Beta', [], 'test-key'), /Google Maps API error/);

  globalThis.fetch = async () => Response.json({ status: 'ZERO_RESULTS', error_message: 'No road route' });
  await assert.rejects(getDirections('Alpha', 'Beta', [], 'test-key'), /ZERO_RESULTS.*No road route/);
});

test('mileage calculation fails closed and never substitutes fabricated distances', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  t.after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  });
  globalThis.fetch = async () => new Response('unavailable', { status: 503, statusText: 'Unavailable' });
  console.error = () => undefined;

  await assert.rejects(
    calculateMileage({
      origin: 'Fail Closed Origin',
      destination: 'Fail Closed Destination',
      journeyType: 'one-way'
    }, { GOOGLE_MAPS_API_KEY: 'invalid-test-key' }),
    /Unable to calculate the road route: Google Maps API error/
  );
});

test('directions returns the real provider payload on success', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const payload = {
    status: 'OK',
    routes: [{ legs: [{ distance: { value: 1234 }, duration: { value: 300 } }] }]
  };
  globalThis.fetch = async () => Response.json(payload);

  assert.deepEqual(await getDirections('Alpha', 'Beta', [], 'test-key'), payload);
});
