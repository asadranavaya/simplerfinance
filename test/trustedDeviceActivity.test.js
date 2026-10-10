const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { eq } = require('drizzle-orm');
const app = require('../server/index');
const { db, sqlite } = require('../server/db');
const { accounts, users, trustedDevices } = require('../server/db/schema');
const { JWT_SECRET } = require('../server/middleware/auth');
const { recordDeviceActivity, trustedDeviceFromCookie } = require('../server/lib/trustedDeviceActivity');

test('device activity groups consecutive IPs by UTC day and preserves IP changes', () => {
  const accountId = crypto.randomUUID();
  db.insert(accounts).values({ id: accountId, name: 'Activity test' }).run();
  const user = db.insert(users).values({ email: `${crypto.randomUUID()}@example.invalid`, passwordHash: 'unused', accountId, createdAt: new Date().toISOString() }).returning().get();
  const deviceId = crypto.randomUUID();
  db.insert(trustedDevices).values({ id: deviceId, userId: user.id, tokenHash: crypto.randomBytes(32).toString('hex'), deviceName: 'Test browser', createdAt: '2026-10-10T00:00:00Z', lastUsedAt: '2026-10-10T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z' }).run();
  try {
    for (const [ip, timestamp] of [
      ['1.1.1.1', '2026-10-10T08:00:00Z'], ['1.1.1.1', '2026-10-10T09:00:00Z'],
      ['8.8.8.8', '2026-10-10T10:00:00Z'], ['8.8.8.8', '2026-10-10T11:00:00Z'],
      ['1.1.1.1', '2026-10-10T12:00:00Z'], ['1.1.1.1', '2026-10-11T00:00:00Z'],
    ]) recordDeviceActivity(deviceId, user.id, ip, 'request', new Date(timestamp));
    const rows = sqlite.prepare('SELECT * FROM trusted_device_activity WHERE device_id=? ORDER BY id').all(deviceId);
    assert.deepEqual(rows.map(row => row.ip_address), ['1.1.1.1', '8.8.8.8', '1.1.1.1', '1.1.1.1']);
    assert.equal(rows[0].last_seen_at, '2026-10-10T09:00:00.000Z');
    assert.equal(rows[1].last_seen_at, '2026-10-10T11:00:00.000Z');
    assert.equal(recordDeviceActivity(deviceId, user.id + 999, '9.9.9.9'), false);
  } finally { db.delete(users).where(eq(users.id, user.id)).run(); db.delete(accounts).where(eq(accounts.id, accountId)).run(); }
});

test('authenticated fetches update device IPs, legacy sessions bind devices, and revocation preserves admin history', async () => {
  const accountId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.insert(accounts).values({ id: accountId, name: 'HTTP activity test' }).run();
  const createUser = role => db.insert(users).values({ email: `${crypto.randomUUID()}@example.invalid`, passwordHash: 'unused', accountId, role, isActive: true, emailVerifiedAt: now, createdAt: now }).returning().get();
  const user = createUser('user');
  const admin = createUser('admin');
  const deviceId = crypto.randomUUID();
  const deviceToken = crypto.randomBytes(32).toString('base64url');
  db.insert(trustedDevices).values({ id: deviceId, userId: user.id, tokenHash: crypto.createHash('sha256').update(deviceToken).digest('hex'), deviceName: 'Test browser', createdAt: now, lastUsedAt: now, expiresAt: new Date(Date.now() + 3600000).toISOString() }).run();
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = (member, extra = {}) => jwt.sign({ userId: member.id, sessionVersion: 0, ...extra }, JWT_SECRET, { expiresIn: '1m' });
  try {
    const legacy = await fetch(`${base}/api/auth/me`, { headers: { cookie: `token=${auth(user)}; trusted_device=${deviceId}.${deviceToken}`, 'cf-connecting-ip': '1.1.1.1' } });
    assert.equal(legacy.status, 200);
    const cookie = legacy.headers.getSetCookie().find(value => value.startsWith('token=')).split(';')[0];
    assert.equal(jwt.verify(decodeURIComponent(cookie.slice(6)), JWT_SECRET).trustedDeviceId, deviceId);
    for (const ip of ['1.1.1.1', '1.1.1.1', '8.8.8.8']) {
      const response = await fetch(`${base}/api/notifications`, { headers: { cookie, 'cf-connecting-ip': ip } });
      assert.equal(response.status, 200);
    }
    assert.equal(db.select().from(trustedDevices).where(eq(trustedDevices.id, deviceId)).get().lastIp, '8.8.8.8');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM trusted_device_activity WHERE device_id=?').get(deviceId).count, 2);
    const historyUrl = `${base}/api/admin/users/${user.id}/trusted-devices/${deviceId}/activity`;
    assert.equal((await fetch(historyUrl, { headers: { cookie, 'cf-connecting-ip': '8.8.8.8' } })).status, 403);
    const adminHeaders = { cookie: `token=${auth(admin)}` };
    assert.equal((await fetch(`${base}/api/admin/users/${admin.id}/trusted-devices/${deviceId}/activity`, { headers: adminHeaders })).status, 404);
    const revoked = await fetch(`${base}/api/auth/sessions/revoke-all`, { method: 'POST', headers: { cookie, 'cf-connecting-ip': '8.8.8.8' } });
    assert.equal(revoked.status, 200);
    assert.ok(db.select().from(trustedDevices).where(eq(trustedDevices.id, deviceId)).get().revokedAt);
    assert.equal(trustedDeviceFromCookie({ cookies: { trusted_device: `${deviceId}.${deviceToken}` } }, user.id), null);
    const history = await (await fetch(historyUrl, { headers: adminHeaders })).json();
    assert.deepEqual(history.history.map(entry => entry.ip), ['8.8.8.8', '1.1.1.1']);
    const details = await (await fetch(`${base}/api/admin/users/${user.id}`, { headers: adminHeaders })).json();
    assert.equal(details.user.trustedDevices[0].isExpired, true);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie } })).status, 401);
    assert.equal(recordDeviceActivity(deviceId, user.id, '9.9.9.9'), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.delete(users).where(eq(users.accountId, accountId)).run();
    db.delete(accounts).where(eq(accounts.id, accountId)).run();
  }
});
