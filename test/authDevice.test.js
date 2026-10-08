const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeviceToken, verifyDeviceToken } = require('../server/middleware/authDevice');

test('server-signed authentication device identifiers verify without exposing the secret', () => {
  const token = createDeviceToken('test-signing-secret', '00000000-0000-4000-8000-000000000000');
  assert.equal(verifyDeviceToken(token, 'test-signing-secret'), '00000000-0000-4000-8000-000000000000');
  assert.equal(token.includes('test-signing-secret'), false);
});

test('authentication device identifiers reject tampering and the wrong signing key', () => {
  const token = createDeviceToken('test-signing-secret', '00000000-0000-4000-8000-000000000000');
  assert.equal(verifyDeviceToken(token.replace('0000', '9999'), 'test-signing-secret'), null);
  assert.equal(verifyDeviceToken(token, 'different-secret'), null);
});
