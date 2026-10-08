const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { eq } = require('drizzle-orm');
const app = require('../server/index');
const { db } = require('../server/db');
const { accounts, users, detectedSubscriptions, subscriptionLinks, monthlySpending, expenses } = require('../server/db/schema');
const { JWT_SECRET } = require('../server/middleware/auth');
const { runSubscriptionDetection } = require('../server/lib/subscriptionDetection');

async function withServer(run) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function subscription(id, userId, description, variants, amount, total, occurrences, first, last) {
  return {
    id, userId, description, variants: JSON.stringify(variants), averageAmount: amount,
    totalPaid: total, firstDetected: first, lastPayment: last, isActive: true,
    occurrences, consecutiveMonths: occurrences,
  };
}

test('customers can fold and un-fold a duplicate detected subscription', async (t) => {
  const accountId = `subscription-links-${crypto.randomUUID()}`;
  const otherAccountId = `subscription-links-other-${crypto.randomUUID()}`;
  const targetId = `sub_${crypto.randomUUID()}`;
  const sourceId = `sub_${crypto.randomUUID()}`;
  const otherId = `sub_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.insert(accounts).values([{ id: accountId, name: 'Subscription owner' }, { id: otherAccountId, name: 'Other owner' }]).run();
  const member = db.insert(users).values({ email: `${crypto.randomUUID()}@example.invalid`, passwordHash: 'unused', accountId, createdAt: now, emailVerifiedAt: now, isActive: true }).returning().get();
  db.insert(detectedSubscriptions).values([
    subscription(targetId, accountId, 'Example Plus', ['EXAMPLE PLUS'], 10, 30, 3, '2026-05-10', '2026-07-10'),
    subscription(sourceId, accountId, 'EXAMPLE.COM SUBSCRIPTION', ['EXAMPLE.COM SUBSCRIPTION'], 12, 36, 3, '2026-05-11', '2026-07-11'),
    subscription(otherId, otherAccountId, 'Other subscription', [], 5, 15, 3, '2026-05-01', '2026-07-01'),
  ]).run();
  t.after(() => {
    db.delete(users).where(eq(users.id, member.id)).run();
    db.delete(accounts).where(eq(accounts.id, accountId)).run();
    db.delete(accounts).where(eq(accounts.id, otherAccountId)).run();
  });

  await withServer(async base => {
    const headers = { cookie: `token=${jwt.sign({ userId: member.id, sessionVersion: 0 }, JWT_SECRET, { expiresIn: '1m' })}`, 'content-type': 'application/json' };
    const foreign = await fetch(`${base}/api/subscriptions/${targetId}/link`, { method: 'POST', headers, body: JSON.stringify({ sourceId: otherId }) });
    assert.equal(foreign.status, 404);

    const linked = await fetch(`${base}/api/subscriptions/${targetId}/link`, { method: 'POST', headers, body: JSON.stringify({ sourceId }) });
    assert.equal(linked.status, 200);
    const grouped = await linked.json();
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].id, targetId);
    assert.equal(grouped[0].averageAmount, 11);
    assert.equal(grouped[0].totalPaid, 66);
    assert.equal(grouped[0].occurrences, 6);
    assert.deepEqual(grouped[0].linkedSubscriptions, [{ id: sourceId, description: 'EXAMPLE.COM SUBSCRIPTION' }]);
    assert.ok(grouped[0].variants.includes('EXAMPLE.COM SUBSCRIPTION'));

    const unlinked = await fetch(`${base}/api/subscriptions/links/${sourceId}`, { method: 'DELETE', headers });
    assert.equal(unlinked.status, 200);
    assert.equal((await unlinked.json()).length, 2);
  });
});

test('detection retains manually linked rows when they are not currently rediscovered', (t) => {
  const accountId = `subscription-link-retention-${crypto.randomUUID()}`;
  const targetId = `sub_${crypto.randomUUID()}`;
  const sourceId = `sub_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.insert(accounts).values({ id: accountId, name: 'Subscription retention owner' }).run();
  db.insert(detectedSubscriptions).values([
    subscription(targetId, accountId, 'Rent', ['Rent'], 1200, 3600, 3, '2026-05-01', '2026-07-01'),
    subscription(sourceId, accountId, 'PROPERTY PAYMENT', ['PROPERTY PAYMENT'], 1200, 3600, 3, '2026-05-01', '2026-07-01'),
  ]).run();
  db.insert(subscriptionLinks).values({ id: crypto.randomUUID(), userId: accountId, sourceSubscriptionId: sourceId, targetSubscriptionId: targetId, createdAt: now }).run();
  t.after(() => db.delete(accounts).where(eq(accounts.id, accountId)).run());

  assert.deepEqual(runSubscriptionDetection(accountId), []);
  const retained = db.select().from(detectedSubscriptions).where(eq(detectedSubscriptions.userId, accountId)).all();
  assert.equal(retained.length, 2);
  assert.ok(retained.every(row => row.isActive === false));
  assert.equal(db.select().from(subscriptionLinks).where(eq(subscriptionLinks.userId, accountId)).all().length, 1);
});

test('manual links override automatic amount variance and choose one representative charge per month', (t) => {
  const accountId = `subscription-link-override-${crypto.randomUUID()}`;
  const targetId = `sub_${crypto.randomUUID()}`;
  const sourceId = `sub_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.insert(accounts).values({ id: accountId, name: 'Variable subscription owner' }).run();
  db.insert(detectedSubscriptions).values([
    subscription(targetId, accountId, 'Rent', ['Rent'], 2400, 14400, 6, '2025-08-01', '2026-01-01'),
    subscription(sourceId, accountId, 'BILT HOUSING', ['BILT HOUSING'], 2900, 8700, 3, '2026-06-03', '2026-08-04'),
  ]).run();
  db.insert(subscriptionLinks).values({ id: crypto.randomUUID(), userId: accountId, sourceSubscriptionId: sourceId, targetSubscriptionId: targetId, createdAt: now }).run();
  for (const [month, charges] of [[6, [2915.93, 187.60]], [7, [3163.41]], [8, [3180.79]]]) {
    const spendingId = crypto.randomUUID();
    db.insert(monthlySpending).values({ id: spendingId, userId: accountId, year: 2026, month, cardId: 'test-card' }).run();
    for (const amount of charges) db.insert(expenses).values({ id: crypto.randomUUID(), spendingId, description: 'BILT HOUSING', amount, date: `2026-${String(month).padStart(2, '0')}-03`, data: '{}' }).run();
  }
  t.after(() => db.delete(accounts).where(eq(accounts.id, accountId)).run());

  runSubscriptionDetection(accountId);
  const refreshed = db.select().from(detectedSubscriptions).where(eq(detectedSubscriptions.id, sourceId)).get();
  assert.equal(refreshed.isActive, true);
  assert.equal(refreshed.occurrences, 3);
  assert.equal(refreshed.consecutiveMonths, 3);
  assert.equal(refreshed.totalPaid, 9260.13);
  assert.equal(refreshed.averageAmount, 3086.71);
});
