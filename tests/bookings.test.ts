import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../src/app';

test('POST /api/bookings creates and persists a new customer booking', async () => {
  const payload = {
    customer: {
      name: 'Jane Passenger',
      email: 'jane@example.com',
      phone: '07123456789'
    },
    journey: {
      origin: 'Birmingham Airport',
      destination: 'Walsall Town Center',
      journeyType: 'one-way',
      passengers: 4,
      departureDate: new Date(Date.now() + 86400000).toISOString()
    },
    quote: {
      vehicle: { id: 'minibus', name: 'Executive Minibus' },
      result: { finalPrice: 165 }
    }
  };

  const postRes = await app.fetch(new Request('http://localhost/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }));

  assert.equal(postRes.status, 201);
  const postData = await postRes.json() as any;
  assert.equal(postData.success, true);
  assert.ok(postData.booking);
  assert.ok(postData.booking.id.startsWith('BK'));
  assert.equal(postData.booking.customer.name, 'Jane Passenger');
  assert.equal(postData.booking.status, 'new');
});

test('POST /api/bookings validates required fields', async () => {
  const invalidPayload = {
    customer: { name: '', email: 'invalid' },
    journey: { origin: '', destination: '' }
  };

  const res = await app.fetch(new Request('http://localhost/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(invalidPayload)
  }));

  assert.equal(res.status, 400);
  const data = await res.json() as any;
  assert.ok(data.error);
});
