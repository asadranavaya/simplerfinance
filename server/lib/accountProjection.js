const { eq, and } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const {
  financialAccountLinks,
  simplefinAccounts,
  simplefinConnections,
  financialProfiles,
} = require('../db/schema');
const { convertCurrency, ratesForDate } = require('./fxRates');
const { revealFinancialAccountData } = require('./customerDataFields');

const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

function activeLink(userId, localAccountType, localAccountId) {
  return db.select().from(financialAccountLinks).where(and(
    eq(financialAccountLinks.userId, userId),
    eq(financialAccountLinks.localAccountType, localAccountType),
    eq(financialAccountLinks.localAccountId, String(localAccountId)),
    eq(financialAccountLinks.status, 'linked')
  )).get() || null;
}

function simplefinProjection(userId, localAccountType, localAccountId) {
  const link = activeLink(userId, localAccountType, localAccountId);
  if (!link) return null;
  const account = db.select().from(simplefinAccounts)
    .where(eq(simplefinAccounts.id, link.simplefinAccountId)).get();
  const connection = account ? db.select().from(simplefinConnections)
    .where(and(
      eq(simplefinConnections.id, account.connectionId),
      eq(simplefinConnections.userId, userId)
    )).get() : null;
  if (!account || !connection) return null;
  if (connection.status === 'disabled' || connection.status === 'revoked') return null;

  const balance = Number(account.balance);
  const profile = db.select().from(financialProfiles).where(eq(financialProfiles.userId, userId)).get();
  const reportingCurrency = profile?.reportingCurrency || 'USD';
  const fx = ratesForDate(new Date().toISOString().slice(0, 10));
  const convertedBalance = account.currency === reportingCurrency
    ? balance
    : convertCurrency(balance, account.currency, reportingCurrency, fx.rates);
  const lastSuccess = connection.lastSyncSucceededAt ? new Date(connection.lastSyncSucceededAt).getTime() : 0;
  const isStale = connection.status !== 'active'
    || !lastSuccess
    || Date.now() - lastSuccess > STALE_AFTER_MS;
  return {
    connected: true,
    linkId: link.id,
    institutionName: account.institutionName,
    remoteName: account.remoteName,
    currency: account.currency,
    balance: Number.isFinite(balance) ? balance : null,
    balanceExact: account.balance,
    availableBalance: account.availableBalance,
    balanceDate: account.balanceDate,
    lastSyncSucceededAt: connection.lastSyncSucceededAt,
    connectionStatus: connection.status,
    isStale,
    includedInNetWorth: Number.isFinite(convertedBalance),
    convertedBalance: Number.isFinite(convertedBalance) ? convertedBalance : null,
    reportingCurrency,
    fxRateDate: fx.date,
  };
}

function manualBalance(row, userId, type) {
  if (!row?.data) return 0;
  try {
    const data = JSON.parse(revealFinancialAccountData(sqlite, userId, type, row.data));
    const value = Number(data.balance ?? data.currentBalance ?? data.marketValue ?? 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function projectedBalance(userId, type, row) {
  const simplefin = simplefinProjection(userId, type, row.id);
  return {
    value: simplefin?.balance ?? manualBalance(row, userId, type),
    source: simplefin ? 'simplefin' : 'manual',
    simplefin,
  };
}

module.exports = { activeLink, simplefinProjection, manualBalance, projectedBalance, STALE_AFTER_MS };
