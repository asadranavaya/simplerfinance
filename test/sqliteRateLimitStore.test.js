const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { SqliteRateLimitStore } = require('../server/lib/sqliteRateLimitStore');

test('SQLite rate-limit counters remain available to a new store instance', () => {
  const prefix = `test-${crypto.randomUUID()}`;
  const first = new SqliteRateLimitStore(prefix);
  first.init({ windowMs: 60_000 });
  assert.equal(first.increment('identity').totalHits, 1);

  const afterRestart = new SqliteRateLimitStore(prefix);
  afterRestart.init({ windowMs: 60_000 });
  assert.equal(afterRestart.get('identity').totalHits, 1);
  assert.equal(afterRestart.increment('identity').totalHits, 2);
  afterRestart.resetAll();
  assert.equal(first.get('identity'), null);
});
