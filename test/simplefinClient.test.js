const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPublicIp,
  parseHttpsUrl,
  decodeSetupToken,
} = require('../server/lib/simplefinClient');

test('rejects private, loopback, link-local and mapped private addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicIp(address), false, address);
  }
  assert.equal(isPublicIp('8.8.8.8'), true);
  assert.equal(isPublicIp('2606:4700:4700::1111'), true);
});

test('accepts only credential-free HTTPS claim URLs', () => {
  assert.equal(parseHttpsUrl('https://bridge.simplefin.org/simplefin/claim/example').protocol, 'https:');
  assert.throws(() => parseHttpsUrl('http://bridge.simplefin.org/claim/example'), /must use HTTPS/);
  assert.throws(() => parseHttpsUrl('https://user:pass@example.com/claim/example'), /must not contain credentials/);
  assert.throws(() => parseHttpsUrl('https://service.local/claim/example'), /hostname is not allowed/);
});

test('decodes standard and URL-safe setup tokens', () => {
  const claimUrl = 'https://bridge.simplefin.org/simplefin/claim/example';
  assert.equal(decodeSetupToken(Buffer.from(claimUrl).toString('base64')), claimUrl);
  assert.equal(decodeSetupToken(Buffer.from(claimUrl).toString('base64url')), claimUrl);
  assert.throws(() => decodeSetupToken('not a valid token!'), /valid SimpleFIN setup token/);
});
