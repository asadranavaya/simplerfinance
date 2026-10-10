const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { eq } = require('drizzle-orm');
const app = require('../server/index');
const { db, sqlite } = require('../server/db');
const { accounts, accountFeatureFlags, creditCards, expenses, monthlySpending, users } = require('../server/db/schema');
const { protectExpenseRecord } = require('../server/lib/customerDataFields');
const { JWT_SECRET } = require('../server/middleware/auth');
const { deliverPurchaseReminders } = require('../server/lib/purchaseReminders');

async function withServer(run) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('purchase notes are available to owners while diagnostic metadata remains feature-gated', async (t) => {
  const ownerAccountId = `purchase-notes-owner-${crypto.randomUUID()}`;
  const otherAccountId = `purchase-notes-other-${crypto.randomUUID()}`;
  const cardId = `card-${crypto.randomUUID()}`;
  const spendingId = `spending-${crypto.randomUUID()}`;
  const expenseId = `expense-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.insert(accounts).values([{ id: ownerAccountId, name: 'Notes owner' }, { id: otherAccountId, name: 'Other owner' }]).run();
  const owner = db.insert(users).values({ email: `${crypto.randomUUID()}@example.invalid`, passwordHash: 'unused', accountId: ownerAccountId, createdAt: now, emailVerifiedAt: now, isActive: true }).returning().get();
  const other = db.insert(users).values({ email: `${crypto.randomUUID()}@example.invalid`, passwordHash: 'unused', accountId: otherAccountId, createdAt: now, emailVerifiedAt: now, isActive: true }).returning().get();
  db.insert(creditCards).values({ id: cardId, userId: ownerAccountId, name: 'Notes card', data: '{}' }).run();
  db.insert(monthlySpending).values({ id: spendingId, userId: ownerAccountId, year: 2026, month: 10, cardId }).run();
  db.insert(expenses).values(protectExpenseRecord(sqlite, ownerAccountId, {
    id: expenseId,
    spendingId,
    description: 'Dinner',
    amount: 42,
    category: 'Food',
    date: '2026-10-09',
    data: JSON.stringify({ categories: ['Food'], mainCategory: 'Food', notes: 'Initial note', reportingCurrency: 'CAD', internalMarker: 'restricted' }),
  })).run();
  t.after(() => {
    db.delete(users).where(eq(users.id, owner.id)).run();
    db.delete(users).where(eq(users.id, other.id)).run();
    db.delete(accounts).where(eq(accounts.id, ownerAccountId)).run();
    db.delete(accounts).where(eq(accounts.id, otherAccountId)).run();
  });

  await withServer(async (base) => {
    const ownerToken = jwt.sign({ userId: owner.id, sessionVersion: 0 }, JWT_SECRET, { expiresIn: '1m' });
    const otherToken = jwt.sign({ userId: other.id, sessionVersion: 0 }, JWT_SECRET, { expiresIn: '1m' });
    const headers = { cookie: `token=${ownerToken}`, 'content-type': 'application/json' };

    const basicResponse = await fetch(`${base}/api/spending/expense/${expenseId}/diagnostics`, { headers });
    assert.equal(basicResponse.status, 200);
    const basic = await basicResponse.json();
    assert.equal(basic.diagnosticsEnabled, false);
    assert.equal(basic.purchase.notes, 'Initial note');
    assert.equal(basic.purchase.reportingCurrency, 'CAD');
    assert.equal('metadata' in basic.purchase, false);
    assert.equal('simplefin' in basic, false);

    const forbidden = await fetch(`${base}/api/spending/expense/${expenseId}/diagnostics`, { headers: { cookie: `token=${otherToken}` } });
    assert.equal(forbidden.status, 404);

    const savedResponse = await fetch(`${base}/api/spending/expense/${expenseId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ year: 2026, month: 10, cardId, updateData: { notes: 'Updated private note' } }),
    });
    assert.equal(savedResponse.status, 200);
    assert.equal((await savedResponse.json()).notes, 'Updated private note');

    const reminderUrl = `${base}/api/spending/expense/${expenseId}/reminder`;
    const dueAt = new Date(Date.now() + 60000).toISOString();
    const setReminder = (value, requestHeaders = headers) => fetch(reminderUrl, {
      method: 'PUT', headers: requestHeaders, body: JSON.stringify({ dueAt: value }),
    });
    assert.equal((await setReminder(dueAt, { ...headers, cookie: `token=${otherToken}` })).status, 404);
    assert.equal((await setReminder('invalid')).status, 400);
    assert.equal((await setReminder(new Date(Date.now() - 60000).toISOString())).status, 400);
    const scheduled = await setReminder(dueAt);
    assert.equal(scheduled.status, 200);
    assert.equal((await scheduled.json()).reminder.dueAt, dueAt);
    const upcoming = await (await fetch(`${base}/api/notifications/upcoming`, { headers })).json();
    assert.deepEqual(upcoming.events, [{ expenseId, description: 'Dinner', notes: 'Updated private note', dueAt }]);
    const otherUpcoming = await (await fetch(`${base}/api/notifications/upcoming`, { headers: { cookie: `token=${otherToken}` } })).json();
    assert.deepEqual(otherUpcoming.events, []);
    assert.equal(deliverPurchaseReminders(new Date(Date.now())), 0);
    assert.equal(deliverPurchaseReminders(new Date(Date.now() + 120000)), 1);
    assert.equal(deliverPurchaseReminders(new Date(Date.now() + 180000)), 0);
    assert.deepEqual((await (await fetch(`${base}/api/notifications/upcoming`, { headers })).json()).events, []);
    const notices = await (await fetch(`${base}/api/notifications`, { headers })).json();
    assert.equal(notices.notifications.filter(item => item.metadata.expenseId === expenseId).length, 1);
    assert.equal(notices.notifications.find(item => item.metadata.expenseId === expenseId).message, 'Updated private note');
    const others = await (await fetch(`${base}/api/notifications`, { headers: { cookie: `token=${otherToken}` } })).json();
    assert.equal(others.notifications.length, 0);
    assert.equal((await setReminder(dueAt)).status, 200);
    assert.equal((await setReminder(null)).status, 200);
    assert.deepEqual((await (await fetch(`${base}/api/notifications/upcoming`, { headers })).json()).events, []);
    assert.equal(deliverPurchaseReminders(new Date(Date.now() + 180000)), 0);

    db.insert(accountFeatureFlags).values({ accountId: ownerAccountId, featureKey: 'purchase_data_inspector', enabledAt: now, enabledBy: null }).run();
    const diagnosticResponse = await fetch(`${base}/api/spending/expense/${expenseId}/diagnostics`, { headers });
    assert.equal(diagnosticResponse.status, 200);
    const diagnostic = await diagnosticResponse.json();
    assert.equal(diagnostic.diagnosticsEnabled, true);
    assert.equal(diagnostic.purchase.notes, 'Updated private note');
    assert.equal(diagnostic.purchase.reminder, null);
    assert.equal(diagnostic.purchase.metadata.internalMarker, 'restricted');
    assert.equal(diagnostic.simplefin, null);
  });
});
