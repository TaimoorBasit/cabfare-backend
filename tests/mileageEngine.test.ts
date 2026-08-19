import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMileage, getDirections, resolveRoutePoints } from '../src/engines/mileageEngine';

test('route points prefer verified coordinates and fall back to address text', () => {
  assert.deepEqual(resolveRoutePoints({
    origin: 'Pickup text',
    destination: 'Destination text',
    waypoints: ['Pickup text', 'Stop text', 'Destination text'],
    wpCoords: [{ lat: 52.5, lng: -1.9 }, null, { lat: 51.5, lng: -0.1 }]
  }), [{ lat: 52.5, lng: -1.9 }, 'Stop text', { lat: 51.5, lng: -0.1 }]);
});

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

  globalThis.fetch = async () => Response.json({ status: 'REQUEST_DENIED', error_message: 'Denied' });
  await assert.rejects(getDirections('Alpha', 'Beta', [], 'test-key'), /REQUEST_DENIED.*Denied/);
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

test('directions geocodes typed UK addresses after ZERO_RESULTS and retries with coordinates', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes('/geocode/')) {
      const lat = url.includes('Alpha') ? 52.5 : 52.6;
      return Response.json({ status: 'OK', results: [{ geometry: { location: { lat, lng: -1.9 } } }] });
    }
    if (requested.filter(item => item.includes('/directions/')).length === 1) {
      return Response.json({ status: 'ZERO_RESULTS' });
    }
    return Response.json({ status: 'OK', routes: [{ legs: [] }] });
  };

  const result = await getDirections('Alpha', 'Beta', [], 'test-key');
  assert.equal(result.status, 'OK');
  assert.match(requested.at(-1) || '', /origin=52\.5%2C-1\.9|origin=52\.5,-1\.9/);
});
