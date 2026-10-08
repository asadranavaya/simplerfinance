const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { eq } = require('drizzle-orm');
const { db } = require('../server/db');
const { accounts, expenses, financialProfiles, monthlySavingsTargets, monthlySpending } = require('../server/db/schema');
const { captureMonthlySavingsTarget, getSavingsProgress } = require('../server/lib/savingsProgress');

test('monthly savings targets remain frozen when salary changes', (t) => {
  const userId = `savings-${crypto.randomUUID()}`;
  const spendingId = `spending-${crypto.randomUUID()}`;
  db.insert(accounts).values({ id: userId, name: 'Savings snapshot test' }).run();
  db.insert(financialProfiles).values({
    userId,
    yearlyIncomeAfterTax: 120_000,
    percentToSave: 10,
    monthlySavingTarget: 1_000,
  }).run();
  t.after(() => db.delete(accounts).where(eq(accounts.id, userId)).run());

  const originalProfile = db.select().from(financialProfiles).where(eq(financialProfiles.userId, userId)).get();
  const january = captureMonthlySavingsTarget(userId, originalProfile, new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(january.monthlyAfterTaxIncome, 10_000);
  assert.equal(january.targetAmount, 1_000);

  db.update(financialProfiles).set({ yearlyIncomeAfterTax: 240_000, percentToSave: 20, monthlySavingTarget: 4_000 })
    .where(eq(financialProfiles.userId, userId)).run();
  const raisedProfile = db.select().from(financialProfiles).where(eq(financialProfiles.userId, userId)).get();
  const frozenJanuary = captureMonthlySavingsTarget(userId, raisedProfile, new Date('2026-01-20T00:00:00.000Z'));
  const february = captureMonthlySavingsTarget(userId, raisedProfile, new Date('2026-02-01T00:00:00.000Z'));
  assert.equal(frozenJanuary.targetAmount, 1_000);
  assert.equal(february.targetAmount, 4_000);

  db.insert(monthlySpending).values({ id: spendingId, userId, year: 2026, month: 1, cardId: 'test-card' }).run();
  db.insert(expenses).values({ id: `expense-${crypto.randomUUID()}`, spendingId, description: 'January spending', amount: 7_000 }).run();
  const progress = getSavingsProgress(userId, 2026);
  assert.equal(progress.targetAmount, 5_000);
  assert.equal(progress.months[0].amountSaved, 3_000);
  assert.equal(progress.months[1].amountSaved, 20_000);
  assert.equal(db.select().from(monthlySavingsTargets).where(eq(monthlySavingsTargets.userId, userId)).all().length, 2);
});
