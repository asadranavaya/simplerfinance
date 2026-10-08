const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { encryptAccessUrl, decryptAccessUrl } = require('../server/lib/simplefinCrypto');
const { sanitizeSimplefinError } = require('../server/lib/simplefinSecurity');

test.beforeEach(() => {
  process.env.SIMPLEFIN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
});

test('encrypts and authenticates a SimpleFIN access URL', () => {
  const original = 'https://example:secret@bridge.simplefin.org/simplefin';
  const encrypted = encryptAccessUrl(original);

  assert.equal(encrypted.encryptionKeyVersion, 1);
  assert.ok(!encrypted.encryptedAccessUrl.includes('secret'));
  assert.equal(decryptAccessUrl(encrypted.encryptedAccessUrl, 1), original);
});

test('rejects tampered ciphertext', () => {
  const encrypted = encryptAccessUrl('https://user:pass@example.com/simplefin');
  const parts = encrypted.encryptedAccessUrl.split('.');
  parts[4] = `${parts[4][0] === 'A' ? 'B' : 'A'}${parts[4].slice(1)}`;
  const tampered = parts.join('.');
  assert.throws(() => decryptAccessUrl(tampered, 1), /Unable to decrypt/);
});

test('requires HTTPS and a valid key', () => {
  assert.throws(() => encryptAccessUrl('http://example.com'), /must use HTTPS/);
  process.env.SIMPLEFIN_ENCRYPTION_KEY = 'short';
  assert.throws(() => encryptAccessUrl('https://example.com'), /64 hexadecimal/);
});

test('redacts credential URLs and token-like secrets from errors', () => {
  const clean = sanitizeSimplefinError('Fetch https://user:secret@example.com/simplefin failed for aHR0cHM6Ly9leGFtcGxlLmNvbS9jbGFpbS9hLXZlcnktbG9uZy10b2tlbg==');
  assert.ok(!clean.includes('secret'));
  assert.ok(!clean.includes('aHR0'));
  assert.match(clean, /REDACTED_SIMPLEFIN_URL/);
  assert.match(clean, /REDACTED_TOKEN/);
});
