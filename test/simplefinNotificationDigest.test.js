const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { db, sqlite } = require('../server/db');
const { accounts } = require('../server/db/schema');
const { eq } = require('drizzle-orm');
const { flushSimplefinSyncDigests, recordSimplefinSyncDigest } = require('../server/lib/simplefinNotificationDigest');

test('SimpleFIN activity produces one notification only after the UTC day closes', (t) => {
  const accountId = `digest-${crypto.randomUUID()}`;
  db.insert(accounts).values({ id: accountId, name: 'Digest test' }).run();
  t.after(() => db.delete(accounts).where(eq(accounts.id, accountId)).run());

  recordSimplefinSyncDigest(accountId, { connectionId:'connection-a', accountsChecked: 2, transactionsUpdated: 3, expensesImported: 1 }, new Date('2026-08-11T03:00:00Z'));
  recordSimplefinSyncDigest(accountId, { connectionId:'connection-a', accountsChecked: 2, transactionsUpdated: 1, warningCount: 1 }, new Date('2026-08-11T20:00:00Z'));
  recordSimplefinSyncDigest(accountId, { connectionId:'connection-b', accountsChecked: 3 }, new Date('2026-08-11T22:00:00Z'));

  assert.equal(flushSimplefinSyncDigests(new Date('2026-08-11T23:59:59Z')), 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM notifications WHERE account_id = ?').get(accountId).count, 0);
  assert.equal(flushSimplefinSyncDigests(new Date('2026-08-12T00:00:01Z')), 1);

  const notices = sqlite.prepare('SELECT * FROM notifications WHERE account_id = ?').all(accountId);
  assert.equal(notices.length, 1);
  assert.match(notices[0].message, /3 syncs/);
  assert.match(notices[0].message, /5 accounts checked/);
  assert.match(notices[0].message, /4 transactions updated/);
  assert.match(notices[0].message, /1 warning/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM simplefin_notification_digests WHERE account_id = ?').get(accountId).count, 0);
});

test('repeated account warning reports count as one daily issue', (t) => {
  const accountId = `digest-warning-${crypto.randomUUID()}`;
  db.insert(accounts).values({ id: accountId, name: 'Digest warning test' }).run();
  t.after(() => db.delete(accounts).where(eq(accounts.id, accountId)).run());
  const warning = { code: 'account_unavailable', message: 'One linked account could not be refreshed.' };

  recordSimplefinSyncDigest(accountId, { connectionId: 'connection-a', accountsChecked: 16, warningCount: 1, warnings: [warning] }, new Date('2026-08-11T03:00:00Z'));
  recordSimplefinSyncDigest(accountId, { connectionId: 'connection-a', accountsChecked: 16, warningCount: 1, warnings: [warning] }, new Date('2026-08-11T09:00:00Z'));
  recordSimplefinSyncDigest(accountId, { connectionId: 'connection-a', accountsChecked: 16, warningCount: 1, warnings: [warning] }, new Date('2026-08-11T15:00:00Z'));

  assert.equal(flushSimplefinSyncDigests(new Date('2026-08-12T00:00:01Z')), 1);
  const notice = sqlite.prepare('SELECT * FROM notifications WHERE account_id = ?').get(accountId);
  assert.match(notice.message, /3 syncs/);
  assert.match(notice.message, /16 accounts checked/);
  assert.match(notice.message, /1 warning/);
  assert.doesNotMatch(notice.message, /3 warnings/);
});
