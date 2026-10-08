const crypto = require('crypto');
const { and, eq, isNull } = require('drizzle-orm');
const { db } = require('../db');
const { authSecurityEvents } = require('../db/schema');

const resetters = new Set();

function getRequestIp(req) {
  return String(req.headers?.['cf-connecting-ip'] || req.ip || req.socket?.remoteAddress || 'unknown').trim().slice(0, 100);
}

function deviceFingerprint(deviceId) {
  return deviceId
    ? `SHA-256 ${crypto.createHash('sha256').update(deviceId).digest('hex').slice(0, 16)}`
    : null;
}

function normalizeEmails(values) {
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim().toLowerCase().slice(0, 254)))].slice(0, 25);
}

function parseEmails(value) {
  try { return normalizeEmails(JSON.parse(value || '[]')); } catch { return []; }
}

function recordSecurityBlock({ req, reason, lockMs, emails = [] }) {
  const now = new Date();
  const nowIso = now.toISOString();
  const ipAddress = getRequestIp(req);
  const deviceId = req.authDeviceId || null;
  const requestedEmails = normalizeEmails([...emails, req.body?.email]);
  const active = db.select().from(authSecurityEvents).where(and(
    eq(authSecurityEvents.reason, reason),
    eq(authSecurityEvents.ipAddress, ipAddress),
    isNull(authSecurityEvents.clearedAt),
  )).all().find(event => event.deviceId === deviceId
    && event.blockedUntil > nowIso);

  if (active) {
    db.update(authSecurityEvents).set({
      attemptedEmails: JSON.stringify(normalizeEmails([...parseEmails(active.attemptedEmails), ...requestedEmails])),
      lastSeenAt: nowIso,
      blockedUntil: new Date(Math.max(new Date(active.blockedUntil).getTime(), now.getTime() + lockMs)).toISOString(),
      hitCount: active.hitCount + 1,
    }).where(eq(authSecurityEvents.id, active.id)).run();
    return active.id;
  }

  const id = crypto.randomUUID();
  db.insert(authSecurityEvents).values({
    id,
    reason,
    attemptedEmails: JSON.stringify(requestedEmails),
    ipAddress,
    deviceId,
    deviceFingerprint: deviceFingerprint(deviceId),
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    blockedUntil: new Date(now.getTime() + lockMs).toISOString(),
    hitCount: 1,
  }).run();
  return id;
}

function registerSecurityResetter(resetter) {
  resetters.add(resetter);
}

function listSecurityEvents() {
  return db.select().from(authSecurityEvents).all()
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, 250)
    .map(({ deviceId: _deviceId, attemptedEmails, ...event }) => ({
      ...event,
      attemptedEmails: parseEmails(attemptedEmails),
      isActive: !event.clearedAt && event.blockedUntil > new Date().toISOString(),
    }));
}

function clearSecurityEvent(id, adminUserId) {
  const event = db.select().from(authSecurityEvents).where(eq(authSecurityEvents.id, id)).get();
  if (!event) return null;
  for (const resetter of resetters) resetter(event);
  const clearedAt = new Date().toISOString();
  db.update(authSecurityEvents).set({ clearedAt, clearedBy: adminUserId })
    .where(eq(authSecurityEvents.id, id)).run();
  return { ...event, clearedAt, clearedBy: adminUserId };
}

module.exports = {
  clearSecurityEvent,
  getRequestIp,
  listSecurityEvents,
  recordSecurityBlock,
  registerSecurityResetter,
};
