import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAdminAuthorization } from '../src/routes/api';

test('Vercel can authenticate a staff request with X-Admin-Token', async () => {
  assert.equal(resolveAdminAuthorization(undefined, 'signed-token'), 'Bearer signed-token');
  assert.equal(resolveAdminAuthorization('Bearer browser-token', 'signed-token'), 'Bearer browser-token');
});
