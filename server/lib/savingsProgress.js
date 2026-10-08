const crypto = require('crypto');
const { and, asc, eq } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const { financialProfiles, monthlySavingsTargets, monthlySpending, expenses } = require('../db/schema');
const { revealExpenseRecord } = require('./customerDataFields');
const { customerPaidAmount } = require('./expenseAmounts');

function targetValues(profile) {
  const monthlyAfterTaxIncome = Math.max(0, Number(profile?.yearlyIncomeAfterTax || 0) / 12);
  const percentToSave = Math.min(100, Math.max(0, Number(profile?.percentToSave || 0)));
  const calculatedTarget = monthlyAfterTaxIncome * percentToSave / 100;
  const targetAmount = calculatedTarget || Math.max(0, Number(profile?.monthlySavingTarget || 0));
  return { monthlyAfterTaxIncome, percentToSave, targetAmount };
}

function captureMonthlySavingsTarget(userId, profile, now = new Date()) {
  const values = targetValues(profile);
  if (!userId || values.monthlyAfterTaxIncome <= 0) return null;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const existing = db.select().from(monthlySavingsTargets).where(and(
    eq(monthlySavingsTargets.userId, userId),
    eq(monthlySavingsTargets.year, year),
    eq(monthlySavingsTargets.month, month)
  )).get();
  if (existing) return existing;
  db.insert(monthlySavingsTargets).values({
    id: `savings_target_${crypto.randomUUID()}`,
    userId,
    year,
    month,
    ...values,
    capturedAt: now.toISOString(),
  }).onConflictDoNothing().run();
  return db.select().from(monthlySavingsTargets).where(and(
    eq(monthlySavingsTargets.userId, userId),
    eq(monthlySavingsTargets.year, year),
    eq(monthlySavingsTargets.month, month)
  )).get();
}

function monthlySpendingTotal(userId, year, month) {
  const records = db.select().from(monthlySpending).where(and(
    eq(monthlySpending.userId, userId), eq(monthlySpending.year, year), eq(monthlySpending.month, month)
  )).all();
  return records.reduce((total, record) => total + db.select().from(expenses)
    .where(eq(expenses.spendingId, record.id)).all()
    .filter(expense => !expense.hiddenAt)
    .reduce((sum, expense) => {
      const revealed = revealExpenseRecord(sqlite, expense);
      let metadata = {}; try { metadata = JSON.parse(revealed.data || '{}'); } catch {}
      return sum + customerPaidAmount(revealed.amount, metadata.split);
    }, 0), 0);
}

function getSavingsProgress(userId, year = new Date().getUTCFullYear()) {
  const targets = db.select().from(monthlySavingsTargets).where(and(
    eq(monthlySavingsTargets.userId, userId),
    eq(monthlySavingsTargets.year, year)
  )).orderBy(asc(monthlySavingsTargets.month)).all();
  const months = targets.map(target => {
    const spending = monthlySpendingTotal(userId, target.year, target.month);
    return {
      year: target.year,
      month: target.month,
      monthlyAfterTaxIncome: target.monthlyAfterTaxIncome,
      percentToSave: target.percentToSave,
      targetAmount: target.targetAmount,
      spending,
      amountSaved: target.monthlyAfterTaxIncome - spending,
      capturedAt: target.capturedAt,
    };
  });
  return {
    year,
    targetAmount: months.reduce((sum, month) => sum + month.targetAmount, 0),
    amountSaved: months.reduce((sum, month) => sum + month.amountSaved, 0),
    months,
  };
}

function captureCurrentSavingsTargets(now = new Date()) {
  const profiles = db.select().from(financialProfiles).all();
  let captured = 0;
  for (const profile of profiles) {
    const before = db.select().from(monthlySavingsTargets).where(and(
      eq(monthlySavingsTargets.userId, profile.userId),
      eq(monthlySavingsTargets.year, now.getUTCFullYear()),
      eq(monthlySavingsTargets.month, now.getUTCMonth() + 1)
    )).get();
    const row = captureMonthlySavingsTarget(profile.userId, profile, now);
    if (!before && row) captured += 1;
  }
  return captured;
}

module.exports = { captureCurrentSavingsTargets, captureMonthlySavingsTarget, getSavingsProgress, monthlySpendingTotal, targetValues };
