const { eq, and, lt } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const {
  bankAccounts,
  tradingAccounts,
  creditCards,
  monthlySpending,
  expenses,
  netWorthSnapshots,
  financialProfiles,
} = require('../db/schema');
const { projectedBalance, simplefinProjection } = require('./accountProjection');
const { convertCurrency, ratesForDate } = require('./fxRates');
const { revealExpenseRecord } = require('./customerDataFields');
const { customerPaidAmount } = require('./expenseAmounts');

function calculateCurrentNetWorth(userId, year, month) {
  const excludedCurrencies = new Set();
  const staleAccounts = new Set();
  let value = 0;
  const profile = db.select().from(financialProfiles).where(eq(financialProfiles.userId, userId)).get();
  const reportingCurrency = profile?.reportingCurrency || 'USD';
  const fx = ratesForDate(new Date().toISOString().slice(0, 10));
  const convertedValue = (amount, currency) => {
    if (currency === reportingCurrency) return Number(amount);
    return convertCurrency(amount, currency, reportingCurrency, fx.rates);
  };

  for (const [type, rows] of [
    ['bank', db.select().from(bankAccounts).where(eq(bankAccounts.userId, userId)).all()],
    ['trading', db.select().from(tradingAccounts).where(eq(tradingAccounts.userId, userId)).all()],
  ]) {
    for (const row of rows) {
      if (!row.isActive) continue;
      const projection = projectedBalance(userId, type, row);
      if (projection.simplefin?.isStale) staleAccounts.add(projection.simplefin.remoteName);
      const currency = projection.simplefin?.currency || 'USD';
      const converted = convertedValue(projection.value, currency);
      if (!Number.isFinite(converted)) { excludedCurrencies.add(currency); continue; }
      value += converted;
    }
  }

  const cards = db.select().from(creditCards).where(eq(creditCards.userId, userId)).all();
  const manualCardIds = new Set();
  for (const card of cards) {
    if (!card.isActive) continue;
    const simplefin = simplefinProjection(userId, 'credit_card', card.id);
    if (!simplefin) {
      manualCardIds.add(card.id);
      continue;
    }
    if (simplefin.isStale) staleAccounts.add(simplefin.remoteName);
    const converted = convertedValue(simplefin.balance, simplefin.currency);
    if (!Number.isFinite(converted)) { excludedCurrencies.add(simplefin.currency); continue; }
    value += converted;
  }

  const spendingRecords = db.select().from(monthlySpending).where(and(
    eq(monthlySpending.userId, userId),
    eq(monthlySpending.year, year),
    eq(monthlySpending.month, month)
  )).all();
  const currentCardDebt = spendingRecords.filter((record) => manualCardIds.has(record.cardId)).reduce((sum, record) => {
    const total = db.select().from(expenses).where(eq(expenses.spendingId, record.id)).all()
      .filter(expense => !expense.hiddenAt)
      .reduce((expenseSum, expense) => {
        const revealed = revealExpenseRecord(sqlite, expense);
        let metadata = {}; try { metadata = JSON.parse(revealed.data || '{}'); } catch {}
        return expenseSum + customerPaidAmount(revealed.amount, metadata.split);
      }, 0);
    return sum + total;
  }, 0);

  const convertedDebt = convertedValue(currentCardDebt, 'USD');
  return {
    value: Math.round((value - (Number.isFinite(convertedDebt) ? convertedDebt : currentCardDebt)) * 100) / 100,
    excludedCurrencies: [...excludedCurrencies].sort(),
    staleAccounts: [...staleAccounts],
    reportingCurrency,
    fxRateDate: fx.date,
  };
}

function refreshCurrentNetWorth(userId, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const period = year * 100 + month;
  const id = `${userId}:${period}`;
  const projection = calculateCurrentNetWorth(userId, year, month);
  const capturedAt = now.toISOString();

  sqlite.transaction(() => {
    db.update(netWorthSnapshots).set({ isFinal: true }).where(and(
      eq(netWorthSnapshots.userId, userId),
      lt(netWorthSnapshots.period, period)
    )).run();
    const existing = db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.id, id)).get();
    if (existing) {
      db.update(netWorthSnapshots).set({ value: projection.value, capturedAt, isFinal: false, reportingCurrency: projection.reportingCurrency })
        .where(eq(netWorthSnapshots.id, id)).run();
    } else {
      db.insert(netWorthSnapshots).values({
        id,
        userId,
        period,
        year,
        month,
        value: projection.value,
        isFinal: false,
        capturedAt,
        reportingCurrency: projection.reportingCurrency,
      }).run();
    }
  })();
  return { ...projection, year, month, period, capturedAt };
}

module.exports = { calculateCurrentNetWorth, refreshCurrentNetWorth };
