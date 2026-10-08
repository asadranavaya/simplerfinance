const test = require('node:test');
const assert = require('node:assert/strict');
const { loginLockout, recordLoginFailure, clearLoginFailures } = require('../server/middleware/loginLockout');
const { clearSecurityEvent, listSecurityEvents } = require('../server/lib/securityActivity');
const { sqlite } = require('../server/db');

function removeDeviceFixture(deviceId) {
  sqlite.prepare('DELETE FROM auth_security_events WHERE device_id = ?').run(deviceId);
  sqlite.prepare("DELETE FROM rate_limit_buckets WHERE bucket_key = ? OR bucket_key LIKE 'login-failure:ip:203.0.113.%'")
    .run(`login-failure:device:${deviceId}`);
  sqlite.prepare("DELETE FROM rate_limit_buckets WHERE bucket_key = 'login-failure:ip:198.51.100.44'").run();
}

function removeEmailFixture(email, deviceIds = []) {
  sqlite.prepare("DELETE FROM auth_security_events WHERE ip_address LIKE '192.0.2.%' OR attempted_emails LIKE ?")
    .run(`%${email}%`);
  sqlite.prepare("DELETE FROM rate_limit_buckets WHERE bucket_key LIKE 'login-failure:ip:192.0.2.%'").run();
  const removeDeviceBucket = sqlite.prepare('DELETE FROM rate_limit_buckets WHERE bucket_key = ?');
  for (const deviceId of deviceIds) removeDeviceBucket.run(`login-failure:device:${deviceId}`);
}

test('signed browser lockout follows a device across rotating IP addresses and creates a clearable audit event', (t) => {
  const deviceId = '123e4567-e89b-12d3-a456-426614174099';
  removeDeviceFixture(deviceId);
  t.after(() => removeDeviceFixture(deviceId));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    recordLoginFailure({
      authDeviceId: deviceId,
      headers: { 'cf-connecting-ip': `203.0.113.${attempt + 1}` },
      body: { email: attempt % 2 ? 'target@example.com' : 'other@example.com' },
    });
  }

  const event = listSecurityEvents().find(item => item.deviceFingerprint && item.attemptedEmails.includes('target@example.com'));
  assert.ok(event);
  assert.equal(event.reason, 'Repeated invalid login credentials');
  assert.equal(event.ipAddress, '203.0.113.10');
  assert.equal(event.attemptedEmails.includes('other@example.com'), true);
  assert.equal(Object.hasOwn(event, 'deviceId'), false);

  const request = { authDeviceId: deviceId, headers: { 'cf-connecting-ip': '198.51.100.44' } };
  let status;
  let body;
  loginLockout(request, {
    status(value) { status = value; return this; },
    json(value) { body = value; return this; },
  }, () => assert.fail('a locked signed browser identifier must not reach the login handler'));

  assert.equal(status, 429);
  assert.equal(body.locked, true);
  clearSecurityEvent(event.id, 1);
  loginLockout(request, {}, () => { status = 200; });
  assert.equal(status, 200);
  clearLoginFailures(request);
});

test('email lockout follows a targeted account across rotating IPs and browser identifiers', (t) => {
  const email = `target-${Date.now()}@example.invalid`;
  removeEmailFixture(email);
  const deviceIds = [];
  t.after(() => removeEmailFixture(email, deviceIds));
  let finalRequest;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const deviceId = `device-${Date.now()}-${attempt}`;
    deviceIds.push(deviceId);
    finalRequest = {
      authDeviceId: deviceId,
      headers: { 'cf-connecting-ip': `192.0.2.${attempt + 1}` },
      body: { email },
    };
    recordLoginFailure(finalRequest);
  }
  const event = listSecurityEvents().find(item => item.attemptedEmails.includes(email));
  assert.ok(event);

  const rotatedRequest = {
    authDeviceId: `entirely-new-device-${Date.now()}`,
    headers: { 'cf-connecting-ip': '192.0.2.200' },
    body: { email },
  };
  deviceIds.push(rotatedRequest.authDeviceId);
  let status;
  loginLockout(rotatedRequest, {
    status(value) { status = value; return this; }, json() { return this; },
  }, () => assert.fail('a targeted email must remain locked across source rotation'));
  assert.equal(status, 429);
  clearLoginFailures(rotatedRequest);
  clearSecurityEvent(event.id, 1);
});
