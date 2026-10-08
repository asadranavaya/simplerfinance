const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const app = require('../server/index');
const { db } = require('../server/db');
const { accounts, users, notifications } = require('../server/db/schema');
const { eq } = require('drizzle-orm');
const { JWT_SECRET } = require('../server/middleware/auth');
const { createNotification } = require('../server/lib/notifications');

async function withServer(run) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function createMember(label) {
  const accountId = `notification-${label}-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.insert(accounts).values({ id: accountId, name: `${label} notification account` }).run();
  const user = db.insert(users).values({
    email: `${crypto.randomUUID()}@example.invalid`,
    passwordHash: 'not-used',
    accountId,
    createdAt: now,
    emailVerifiedAt: now,
    isActive: true,
  }).returning().get();
  return { accountId, user };
}

test('notification history and acknowledgement deletion remain isolated by account', async (t) => {
  const first = createMember('first');
  const second = createMember('second');
  const firstNotice = createNotification(first.accountId, { title: 'First only', message: 'Private account event' });
  const secondNotice = createNotification(second.accountId, { title: 'Second only', message: 'Another private event' });
  t.after(() => {
    db.delete(users).where(eq(users.id, first.user.id)).run();
    db.delete(users).where(eq(users.id, second.user.id)).run();
    db.delete(accounts).where(eq(accounts.id, first.accountId)).run();
    db.delete(accounts).where(eq(accounts.id, second.accountId)).run();
  });

  await withServer(async base => {
    const token = jwt.sign({ userId: first.user.id, sessionVersion: 0 }, JWT_SECRET, { expiresIn: '1m' });
    const headers = { cookie: `token=${token}` };
    const historyResponse = await fetch(`${base}/api/notifications`, { headers });
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.equal(history.unreadCount, 1);
    assert.deepEqual(history.notifications.map(item => item.id), [firstNotice.id]);

    const forbiddenRead = await fetch(`${base}/api/notifications/${secondNotice.id}/read`, { method: 'PATCH', headers });
    assert.equal(forbiddenRead.status, 404);
    assert.ok(db.select().from(notifications).where(eq(notifications.id, secondNotice.id)).get());

    const ownRead = await fetch(`${base}/api/notifications/${firstNotice.id}/read`, { method: 'PATCH', headers });
    assert.equal(ownRead.status, 200);
    assert.equal(db.select().from(notifications).where(eq(notifications.id, firstNotice.id)).get(), undefined);
  });
});
