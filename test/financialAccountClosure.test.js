const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { eq } = require('drizzle-orm');
const app = require('../server/index');
const { db } = require('../server/db');
const { accounts, creditCards, expenses, monthlySpending, users } = require('../server/db/schema');
const { JWT_SECRET } = require('../server/middleware/auth');

async function withServer(run) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('closed financial accounts preserve history and reject new activity until reactivated', async (t) => {
  const accountId = `closure-${crypto.randomUUID()}`;
  const cardId = `card-${crypto.randomUUID()}`;
  const spendingId = `spending-${crypto.randomUUID()}`;
  const expenseId = `expense-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.insert(accounts).values({ id: accountId, name: 'Closure test' }).run();
  const member = db.insert(users).values({ email: `${crypto.randomUUID()}@example.invalid`, passwordHash: 'unused', accountId, createdAt: now, emailVerifiedAt: now, isActive: true }).returning().get();
  db.insert(creditCards).values({ id: cardId, userId: accountId, name: 'Historical card', data: '{}' }).run();
  db.insert(monthlySpending).values({ id: spendingId, userId: accountId, year: 2026, month: 7, cardId }).run();
  db.insert(expenses).values({ id: expenseId, spendingId, description: 'Preserved purchase', amount: 25, data: '{}' }).run();
  t.after(() => {
    db.delete(users).where(eq(users.id, member.id)).run();
    db.delete(accounts).where(eq(accounts.id, accountId)).run();
  });

  await withServer(async base => {
    const token = jwt.sign({ userId: member.id, sessionVersion: 0 }, JWT_SECRET, { expiresIn: '1m' });
    const headers = { cookie: `token=${token}`, 'content-type': 'application/json' };
    const close = await fetch(`${base}/api/financial-accounts/credit_card/${cardId}/status`, { method: 'PATCH', headers, body: JSON.stringify({ isActive: false }) });
    assert.equal(close.status, 200);
    assert.equal((await close.json()).isActive, false);

    const history = await fetch(`${base}/api/spending?year=2026&month=7`, { headers });
    assert.equal(history.status, 200);
    assert.equal((await history.json())[0].expenses[0].description, 'Preserved purchase');

    const newExpense = { year: 2026, month: 8, cardId, expenseData: { description: 'Blocked purchase', amount: 10, date: '2026-08-01', categories: [] } };
    const blocked = await fetch(`${base}/api/spending/expense`, { method: 'POST', headers, body: JSON.stringify(newExpense) });
    assert.equal(blocked.status, 409);

    const reactivate = await fetch(`${base}/api/financial-accounts/credit_card/${cardId}/status`, { method: 'PATCH', headers, body: JSON.stringify({ isActive: true }) });
    assert.equal(reactivate.status, 200);
    const created = await fetch(`${base}/api/spending/expense`, { method: 'POST', headers, body: JSON.stringify(newExpense) });
    assert.equal(created.status, 200);
  });
});
