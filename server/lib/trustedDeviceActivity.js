const crypto = require('crypto');
const { sqlite } = require('../db');
const { getRequestIp } = require('./securityActivity');

function trustedDeviceFromCookie(req, userId) {
  const [id, token, extra] = String(req.cookies?.trusted_device || '').split('.');
  if (!id || !token || extra) return null;
  const device = sqlite.prepare('SELECT * FROM trusted_devices WHERE id=? AND user_id=?').get(id, userId);
  if (!device || device.revoked_at || device.expires_at <= new Date().toISOString()) return null;
  const supplied = crypto.createHash('sha256').update(token).digest();
  const expected = Buffer.from(device.token_hash, 'hex');
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied) ? device.id : null;
}

function recordDeviceActivity(deviceId, userId, ip, source = 'request', now = new Date()) {
  const timestamp = now.toISOString();
  return sqlite.transaction(() => {
    const device = sqlite.prepare('SELECT * FROM trusted_devices WHERE id=? AND user_id=?').get(deviceId, userId);
    if (!device || device.revoked_at) return false;
    const latest = sqlite.prepare('SELECT * FROM trusted_device_activity WHERE device_id=? ORDER BY id DESC LIMIT 1').get(deviceId);
    if (!latest || latest.ip_address !== ip || latest.first_seen_at.slice(0, 10) !== timestamp.slice(0, 10)) {
      sqlite.prepare(`INSERT INTO trusted_device_activity(device_id,ip_address,first_seen_at,last_seen_at,source) VALUES(?,?,?,?,?)`).run(deviceId, ip, timestamp, timestamp, source);
    } else {
      sqlite.prepare('UPDATE trusted_device_activity SET last_seen_at=? WHERE id=?').run(timestamp, latest.id);
    }
    sqlite.prepare('UPDATE trusted_devices SET last_ip=?, last_used_at=? WHERE id=?').run(ip, timestamp, deviceId);
    return true;
  })();
}

function recordRequestDeviceActivity(req, deviceId) {
  return recordDeviceActivity(deviceId, req.user.userId, getRequestIp(req));
}

function expireTrustedDevices(userId) {
  const now = new Date().toISOString();
  sqlite.prepare('UPDATE trusted_devices SET revoked_at=?, expires_at=MIN(expires_at,?) WHERE user_id=? AND revoked_at IS NULL').run(now, now, userId);
}

module.exports = { trustedDeviceFromCookie, recordDeviceActivity, recordRequestDeviceActivity, expireTrustedDevices };
