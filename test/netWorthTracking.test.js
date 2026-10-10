const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { eq } = require('drizzle-orm');
const app = require('../server/index');
const { db, sqlite } = require('../server/db');
const { accounts, users, bankAccounts, tradingAccounts } = require('../server/db/schema');
const { protectFinancialAccountData } = require('../server/lib/customerDataFields');
const { JWT_SECRET } = require('../server/middleware/auth');

async function withServer(run) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('net worth inclusion defaults on and exposes a live tracked-account subset', async (t) => {
  const ownerAccountId = `net-worth-owner-${crypto.randomUUID()}`;
  const otherAccountId = `net-worth-other-${crypto.randomUUID()}`;
  const bankId = `bank-${crypto.randomUUID()}`;
  const tradingId = `trading-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.insert(accounts).values([{ id: ownerAccountId, name: 'Net worth owner' }, { id: otherAccountId, name: 'Other owner' }]).run();
  const owner = db.insert(users).values({ email: `${crypto.randomUUID()}@example.invalid`, passwordHash: 'unused', accountId: ownerAccountId, createdAt: now, emailVerifiedAt: now, isActive: true }).returning().get();
  const other = db.insert(users).values({ email: `${crypto.randomUUID()}@example.invalid`, passwordHash: 'unused', accountId: otherAccountId, createdAt: now, emailVerifiedAt: now, isActive: true }).returning().get();
  db.insert(bankAccounts).values({
    id: bankId,
    userId: ownerAccountId,
    name: 'Everyday bank',
    data: protectFinancialAccountData(sqlite, ownerAccountId, 'bank', JSON.stringify({ bankName: 'Everyday bank', balance: 1000 })),
  }).run();
  db.insert(tradingAccounts).values({
    id: tradingId,
    userId: ownerAccountId,
    name: 'Brokerage',
    data: protectFinancialAccountData(sqlite, ownerAccountId, 'trading', JSON.stringify({ brokerName: 'Brokerage', balance: 500 })),
  }).run();
  t.after(() => {
    db.delete(users).where(eq(users.id, owner.id)).run();
    db.delete(users).where(eq(users.id, other.id)).run();
    db.delete(accounts).where(eq(accounts.id, ownerAccountId)).run();
    db.delete(accounts).where(eq(accounts.id, otherAccountId)).run();
  });

  await withServer(async (base) => {
    const ownerToken = jwt.sign({ userId: owner.id, sessionVersion: 0 }, JWT_SECRET, { expiresIn: '1m' });
    const otherToken = jwt.sign({ userId: other.id, sessionVersion: 0 }, JWT_SECRET, { expiresIn: '1m' });
    const ownerHeaders = { cookie: `token=${ownerToken}`, 'content-type': 'application/json' };

    const initial = await fetch(`${base}/api/net-worth`, { headers: ownerHeaders });
    assert.equal(initial.status, 200);
    assert.deepEqual(await initial.json().then(({ value, trackedValue, hasUntrackedAccounts, untrackedAccountCount }) => ({ value, trackedValue, hasUntrackedAccounts, untrackedAccountCount })), {
      value: 1500,
      trackedValue: 1500,
      hasUntrackedAccounts: false,
      untrackedAccountCount: 0,
    });

    const exclude = await fetch(`${base}/api/financial-accounts/bank/${bankId}/net-worth`, {
      method: 'PATCH', headers: ownerHeaders, body: JSON.stringify({ included: false }),
    });
    assert.equal(exclude.status, 200);
    assert.equal((await exclude.json()).includeInNetWorth, false);

    const updated = await fetch(`${base}/api/net-worth`, { headers: ownerHeaders });
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json().then(({ value, trackedValue, hasUntrackedAccounts, untrackedAccountCount }) => ({ value, trackedValue, hasUntrackedAccounts, untrackedAccountCount })), {
      value: 1500,
      trackedValue: 500,
      hasUntrackedAccounts: true,
      untrackedAccountCount: 1,
    });

    const forbidden = await fetch(`${base}/api/financial-accounts/bank/${bankId}/net-worth`, {
      method: 'PATCH', headers: { cookie: `token=${otherToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ included: true }),
    });
    assert.equal(forbidden.status, 404);
  });
});
