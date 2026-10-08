/** Persistent login lockout across IP, signed browser, and normalized email. */
const { recordSecurityBlock, registerSecurityResetter } = require('../lib/securityActivity');
const { sqlite } = require('../db');
const {
  bucketKey, getBucket, hashRateLimitIdentity, incrementBucket, resetBucket,
} = require('../lib/sqliteRateLimitStore');

const MAX_FAILURES = 10;
const LOCKOUT_MS = 24 * 60 * 60 * 1000;
const PREFIX = 'login-failure';

function getIp(req) {
  return String(req.headers?.['cf-connecting-ip'] || req.ip || req.socket?.remoteAddress || 'unknown').trim().slice(0, 100);
}

function normalizedEmail(req) {
  const value = req.body?.email;
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase().slice(0, 254) : null;
}

function requestKeys(req) {
  const keys = [`ip:${getIp(req)}`];
  if (req.authDeviceId) keys.push(`device:${req.authDeviceId}`);
  const email = normalizedEmail(req);
  if (email) keys.push(`email:${hashRateLimitIdentity(email)}`);
  return keys.map(key => bucketKey(PREFIX, key));
}

function loginLockout(req, res, next) {
  const entry = requestKeys(req).map(getBucket).find(item => item?.totalHits >= MAX_FAILURES);
  if (entry) {
    const minutesLeft = Math.max(1, Math.ceil((entry.resetTime.getTime() - Date.now()) / 60_000));
    return res.status(429).json({
      error: `Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`,
      locked: true,
      minutesLeft,
    });
  }
  next();
}

function recordLoginFailure(req) {
  let remaining = MAX_FAILURES;
  let locked = false;
  const keys = requestKeys(req);
  const email = normalizedEmail(req);
  for (const key of keys) {
    const entry = incrementBucket(key, LOCKOUT_MS);
    if (email) sqlite.prepare('INSERT OR IGNORE INTO login_failure_emails (bucket_key, email) VALUES (?, ?)').run(key, email);
    remaining = Math.min(remaining, Math.max(0, MAX_FAILURES - entry.hit_count));
    if (entry.hit_count >= MAX_FAILURES) locked = true;
  }
  if (locked) {
    const attemptedEmails = [...new Set(keys.flatMap(key => sqlite.prepare(
      'SELECT email FROM login_failure_emails WHERE bucket_key = ? ORDER BY email LIMIT 25'
    ).all(key).map(row => row.email)))].slice(0, 25);
    recordSecurityBlock({
      req,
      reason: 'Repeated invalid login credentials',
      lockMs: LOCKOUT_MS,
      emails: attemptedEmails,
    });
    console.warn('[loginLockout] An IP, browser, or email identity was locked after repeated authentication failures.');
  }
  return remaining;
}

function clearLoginFailures(req) {
  for (const key of requestKeys(req)) resetBucket(key);
}

registerSecurityResetter(event => {
  resetBucket(bucketKey(PREFIX, `ip:${event.ipAddress}`));
  if (event.deviceId) resetBucket(bucketKey(PREFIX, `device:${event.deviceId}`));
  try {
    for (const email of JSON.parse(event.attemptedEmails || '[]')) {
      resetBucket(bucketKey(PREFIX, `email:${hashRateLimitIdentity(email)}`));
    }
  } catch { /* malformed historical audit data cannot block clearing other keys */ }
});

module.exports = { loginLockout, recordLoginFailure, clearLoginFailures, getIp };
