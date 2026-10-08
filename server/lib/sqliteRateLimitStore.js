const crypto = require('crypto');
const { sqlite } = require('../db');

function hashRateLimitIdentity(value) {
  return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex');
}

function bucketKey(prefix, key) {
  return `${prefix}:${key}`.slice(0, 500);
}

function incrementBucket(key, windowMs) {
  const now = Date.now();
  const resetAt = now + windowMs;
  return sqlite.prepare(`
    INSERT INTO rate_limit_buckets (bucket_key, hit_count, reset_at, updated_at)
    VALUES (?, 1, ?, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      hit_count = CASE WHEN reset_at <= excluded.updated_at THEN 1 ELSE hit_count + 1 END,
      reset_at = CASE WHEN reset_at <= excluded.updated_at THEN excluded.reset_at ELSE reset_at END,
      updated_at = excluded.updated_at
    RETURNING hit_count, reset_at
  `).get(key, resetAt, now);
}

function getBucket(key) {
  const row = sqlite.prepare('SELECT hit_count, reset_at FROM rate_limit_buckets WHERE bucket_key = ?').get(key);
  if (!row || row.reset_at <= Date.now()) {
    if (row) sqlite.prepare('DELETE FROM rate_limit_buckets WHERE bucket_key = ?').run(key);
    return null;
  }
  return { totalHits: row.hit_count, resetTime: new Date(row.reset_at) };
}

function resetBucket(key) {
  sqlite.prepare('DELETE FROM rate_limit_buckets WHERE bucket_key = ?').run(key);
}

class SqliteRateLimitStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.localKeys = false;
    this.windowMs = 60_000;
  }

  init(options) { this.windowMs = options.windowMs; }
  get(key) { return getBucket(bucketKey(this.prefix, key)); }
  increment(key) {
    const row = incrementBucket(bucketKey(this.prefix, key), this.windowMs);
    return { totalHits: row.hit_count, resetTime: new Date(row.reset_at) };
  }
  decrement(key) {
    sqlite.prepare('UPDATE rate_limit_buckets SET hit_count = MAX(0, hit_count - 1) WHERE bucket_key = ?')
      .run(bucketKey(this.prefix, key));
  }
  resetKey(key) { resetBucket(bucketKey(this.prefix, key)); }
  resetAll() { sqlite.prepare('DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ?').run(`${this.prefix}:%`); }
}

module.exports = { SqliteRateLimitStore, bucketKey, getBucket, hashRateLimitIdentity, incrementBucket, resetBucket };
