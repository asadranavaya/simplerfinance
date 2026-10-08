const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEnv, renderEnv, safeEnvValue } = require('../scripts/lib/env-file');
const { validateIdentity } = require('../scripts/lib/provision-account');

test('setup environment rendering round-trips values without exposing undefined fields', () => {
  const rendered = renderEnv({ NODE_ENV: 'production', PORT: 3001, JWT_SECRET: 'a'.repeat(64) });
  const parsed = parseEnv(rendered);
  assert.equal(parsed.NODE_ENV, 'production');
  assert.equal(parsed.PORT, '3001');
  assert.equal(parsed.JWT_SECRET, 'a'.repeat(64));
  assert.equal(parsed.SMTP_HOST, '');
  assert.throws(() => safeEnvValue('secret\nINJECTED=true'), /newlines/);
});

test('local account provisioning validates normal users and administrators', () => {
  assert.deepEqual(validateIdentity({ email: ' USER@Example.com ', password: 'a secure password', name: ' Household ', role: 'user' }), {
    email: 'user@example.com', password: 'a secure password', name: 'Household', role: 'user',
  });
  assert.throws(() => validateIdentity({ email: 'bad', password: 'short', name: '', role: 'owner' }), /valid email/);
  assert.throws(() => validateIdentity({ email: 'user@example.com', password: 'short', name: 'User', role: 'user' }), /12 and 128/);
});
