const crypto = require('crypto');
const { eq, and, desc } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const {
  simplefinConnections,
  simplefinAccounts,
  simplefinTransactions,
  simplefinSyncRuns,
  financialAccountLinks,
  expenses,
} = require('../db/schema');
const { decryptAccessUrl } = require('./simplefinCrypto');
const { fetchAccountSet, SimplefinHttpError } = require('./simplefinClient');
const { sanitizeSimplefinError } = require('./simplefinSecurity');
const { materializeConnection } = require('./simplefinMaterialize');
const { descriptionSimilarity } = require('./simplefinMaterialize');
const { runSubscriptionDetection } = require('./subscriptionDetection');
const { reapplyTravelPlans } = require('./travelPlans');
const { refreshCurrentNetWorth } = require('./netWorthProjection');
const { nextScheduleAfterSuccess } = require('./simplefinSchedule');
const { recordSimplefinSyncDigest } = require('./simplefinNotificationDigest');
const { connectionIdsMatch } = require('./simplefinConnectionIssue');
const { encryptCustomerValue } = require('./customerEncryption');
const { isImportedExpenseForTransactions } = require('./simplefinDeletion');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const STALE_LOCK_MS = 15 * 60 * 1000;
const MAX_WINDOW_DAYS = 45;
const OVERLAP_DAYS = 5;
const PENDING_RECONCILIATION_DAYS = 14;
const MONEY_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

class SimplefinSyncError extends Error {
  constructor(message, statusCode = 500, code = 'sync_failed', details = {}) {
    super(message);
    this.name = 'SimplefinSyncError';
    this.statusCode = statusCode;
    this.code = code;
    Object.assign(this, details);
  }
}

function utcDayStart(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new SimplefinSyncError('Invalid transaction import date', 400, 'invalid_import_date');
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function buildTransactionWindows(startValue, endValue = new Date()) {
  let cursor = utcDayStart(startValue);
  const finalEnd = new Date(utcDayStart(endValue).getTime() + DAY_MS);
  const windows = [];

  while (cursor < finalEnd) {
    const end = new Date(Math.min(cursor.getTime() + MAX_WINDOW_DAYS * DAY_MS, finalEnd.getTime()));
    windows.push({
      startDate: Math.floor(cursor.getTime() / 1000),
      endDate: Math.floor(end.getTime() / 1000),
    });
    if (end >= finalEnd) break;
    cursor = new Date(end.getTime() - OVERLAP_DAYS * DAY_MS);
  }
  return windows;
}

function transactionSyncStart(link) {
  const boundary = link.transactionImportFrom || new Date().toISOString().slice(0, 10);
  if (!link.transactionSyncedThrough) return utcDayStart(boundary);
  const overlap = new Date(utcDayStart(link.transactionSyncedThrough).getTime() - PENDING_RECONCILIATION_DAYS * DAY_MS);
  return overlap < utcDayStart(boundary) ? utcDayStart(boundary) : overlap;
}

function providerWarnings(accountSet) {
  return (Array.isArray(accountSet?.errlist) ? accountSet.errlist : []).slice(0, 20).map((warning) => ({
    code: String(warning?.code || 'unknown').slice(0, 80),
    message: sanitizeSimplefinError(warning?.msg || 'SimpleFIN reported a warning'),
    accountId: warning?.account_id == null ? null : String(warning.account_id).slice(0, 500),
    connectionId: warning?.conn_id == null ? null : String(warning.conn_id).slice(0, 500),
  }));
}

function deduplicateWarnings(warnings) {
  const unique = new Map();
  for (const warning of warnings) {
    const key = `${String(warning?.code || '')}\0${String(warning?.message || '')}\0${String(warning?.accountId || '')}\0${String(warning?.connectionId || '')}`;
    if (!unique.has(key)) unique.set(key, warning);
  }
  return [...unique.values()];
}

function epochToIso(value) {
  const milliseconds = Number(value) * 1000;
  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function transactionTimestamps(transaction) {
  const transactedAt = transaction?.transacted_at == null ? null : epochToIso(transaction.transacted_at);
  const providerPostedAt = Number(transaction?.posted) > 0 ? epochToIso(transaction.posted) : null;
  return {
    transactedAt,
    postedAt: providerPostedAt || transactedAt,
  };
}

function acquireLock(connectionId, userId, trigger = 'manual') {
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  let connection;

  sqlite.transaction(() => {
    connection = db.select().from(simplefinConnections)
      .where(and(eq(simplefinConnections.id, connectionId), eq(simplefinConnections.userId, userId))).get();
    if (!connection) throw new SimplefinSyncError('SimpleFIN connection not found', 404, 'not_found');

    const lockStarted = connection.lastSyncStartedAt ? new Date(connection.lastSyncStartedAt).getTime() : 0;
    if (connection.status === 'syncing' && Date.now() - lockStarted < STALE_LOCK_MS) {
      throw new SimplefinSyncError('This SimpleFIN connection is already syncing', 409, 'already_syncing');
    }
    if (connection.nextSyncAllowedAt && connection.nextSyncAllowedAt > startedAt) {
      throw new SimplefinSyncError('This connection was synced recently', 429, 'rate_limited', {
        nextSyncAllowedAt: connection.nextSyncAllowedAt,
      });
    }
    if (connection.status === 'revoked' || connection.status === 'disabled') {
      throw new SimplefinSyncError('This SimpleFIN connection is not active', 400, 'connection_inactive');
    }

    if (connection.status === 'syncing') {
      const recoveredAt = new Date().toISOString();
      const runningRuns = db.select().from(simplefinSyncRuns).where(and(
        eq(simplefinSyncRuns.connectionId, connectionId),
        eq(simplefinSyncRuns.status, 'running')
      )).all();
      for (const staleRun of runningRuns) {
        db.update(simplefinSyncRuns).set({
          status: 'failed',
          completedAt: recoveredAt,
          errorCode: 'stale_lock_recovered',
          errorSummary: 'A previous sync was interrupted and its stale lock was recovered.',
        }).where(eq(simplefinSyncRuns.id, staleRun.id)).run();
      }
    }

    db.update(simplefinConnections).set({ status: 'syncing', lastSyncStartedAt: startedAt })
      .where(eq(simplefinConnections.id, connectionId)).run();
    db.insert(simplefinSyncRuns).values({
      id: runId,
      connectionId,
      startedAt,
      status: 'running',
      trigger,
    }).run();
  })();

  return { connection, runId, startedAt };
}

function remoteAccountValues(connectionId, remote, institutions, now, existing = null, userId = null) {
  if (remote?.id == null || remote?.name == null || remote?.currency == null || remote?.balance == null) return null;
  return {
    id: existing?.id || crypto.randomUUID(),
    connectionId,
    remoteAccountId: String(remote.id),
    remoteConnectionId: remote.conn_id == null ? null : String(remote.conn_id),
    remoteName: String(remote.name).slice(0, 500),
    institutionName: institutions.get(String(remote.conn_id || '')) || existing?.institutionName || null,
    currency: String(remote.currency).slice(0, 40),
    balance: String(remote.balance),
    availableBalance: remote['available-balance'] == null ? null : String(remote['available-balance']),
    balanceDate: epochToIso(remote['balance-date']),
    lastSeenAt: now,
    isActive: true,
    firstSeenAt: existing?.firstSeenAt || now,
    rawData: userId ? encryptCustomerValue(sqlite, userId, 'simplefin-account:raw', JSON.stringify({
      id: remote.id,
      name: remote.name,
      conn_id: remote.conn_id,
      currency: remote.currency,
      balance: remote.balance,
      'available-balance': remote['available-balance'],
      'balance-date': remote['balance-date'],
      extra: remote.extra,
    })) : JSON.stringify({
      id: remote.id,
      name: remote.name,
      conn_id: remote.conn_id,
      currency: remote.currency,
      balance: remote.balance,
      'available-balance': remote['available-balance'],
      'balance-date': remote['balance-date'],
      extra: remote.extra,
    }),
  };
}

function updateRemoteAccounts(connectionId, userId, accountSet, now) {
  const staged = db.select().from(simplefinAccounts).where(eq(simplefinAccounts.connectionId, connectionId)).all();
  const byRemoteId = new Map(staged.map((account) => [account.remoteAccountId, account]));
  const receivedRemoteIds = new Set(accountSet.accounts.map(account => String(account?.id)));
  const institutions = new Map((Array.isArray(accountSet.connections) ? accountSet.connections : [])
    .map((entry) => [String(entry?.conn_id || ''), entry?.org_name || entry?.name || null]));
  let updated = 0;

  if (!accountSet.errlist?.length) {
    for (const account of staged) {
      if (!receivedRemoteIds.has(account.remoteAccountId) && account.isActive) {
        db.update(simplefinAccounts).set({ isActive: false }).where(eq(simplefinAccounts.id, account.id)).run();
      }
    }
  }

  for (const remote of accountSet.accounts) {
    const remoteAccountId = String(remote?.id);
    const account = byRemoteId.get(remoteAccountId);
    const values = remoteAccountValues(connectionId, remote, institutions, now, account, userId);
    if (!values) continue;
    if (account) db.update(simplefinAccounts).set(values).where(eq(simplefinAccounts.id, account.id)).run();
    else {
      db.insert(simplefinAccounts).values(values).run();
      byRemoteId.set(remoteAccountId, values);
    }
    updated += 1;
  }
  return updated;
}

function pendingReplacementCandidate(stagedTransactions, remoteTransaction) {
  if (remoteTransaction?.pending || remoteTransaction?.posted == null || remoteTransaction?.amount == null) return null;
  const { postedAt } = transactionTimestamps(remoteTransaction);
  if (!postedAt) return null;
  const postedTime = new Date(postedAt).getTime();
  const candidates = stagedTransactions.filter((row) => {
    if (!row.pending || row.amount !== String(remoteTransaction.amount)) return false;
    const timeDistance = Math.abs(new Date(row.postedAt).getTime() - postedTime);
    return timeDistance <= 7 * DAY_MS
      && descriptionSimilarity(row.description, remoteTransaction.description || 'Transaction') >= 0.65;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function missingPendingTransactions(stagedTransactions, remoteTransactions, window, now = new Date()) {
  if (!window || !Array.isArray(remoteTransactions)) return [];
  const nowTime = new Date(now).getTime();
  const cutoff = nowTime - PENDING_RECONCILIATION_DAYS * DAY_MS;
  const start = Number(window.startDate) * 1000;
  const end = Number(window.endDate) * 1000;
  if (![nowTime, start, end].every(Number.isFinite)) return [];
  const receivedIds = new Set(remoteTransactions.filter(transaction => transaction?.id != null).map(transaction => String(transaction.id)));
  return stagedTransactions.filter((transaction) => {
    if (!transaction.pending || receivedIds.has(transaction.remoteTransactionId)) return false;
    const activityTime = new Date(transaction.transactedAt || transaction.postedAt).getTime();
    return Number.isFinite(activityTime) && activityTime >= cutoff && activityTime >= start && activityTime < end;
  });
}

function accountResponseHasErrors(accountSet, remoteAccount) {
  if (Array.isArray(accountSet?.errors) && accountSet.errors.length) return true;
  if (remoteAccount?.error || remoteAccount?.errlist?.length || remoteAccount?.errors?.length) return true;
  const accountId = String(remoteAccount?.id ?? '');
  const connectionId = String(remoteAccount?.conn_id ?? '');
  return (Array.isArray(accountSet?.errlist) ? accountSet.errlist : []).some((error) => {
    const errorAccountId = error?.account_id == null ? '' : String(error.account_id);
    const errorConnectionId = error?.conn_id == null ? '' : String(error.conn_id);
    if (!errorAccountId && !errorConnectionId) return true;
    if (errorAccountId) return errorAccountId === accountId;
    return connectionIdsMatch(errorConnectionId, connectionId);
  });
}

function retireMissingPendingTransactions(accountId, remoteTransactions, window, now) {
  const stagedTransactions = db.select().from(simplefinTransactions)
    .where(eq(simplefinTransactions.simplefinAccountId, accountId)).all();
  const missing = missingPendingTransactions(stagedTransactions, remoteTransactions, window, now);
  for (const transaction of missing) {
    if (transaction.expenseId) {
      const expense = db.select().from(expenses).where(eq(expenses.id, transaction.expenseId)).get();
      if (isImportedExpenseForTransactions(expense, new Set([transaction.id]))) {
        db.delete(expenses).where(eq(expenses.id, expense.id)).run();
      }
    }
    db.delete(simplefinTransactions).where(eq(simplefinTransactions.id, transaction.id)).run();
  }
  return missing.length;
}

function upsertTransactions(connectionId, userId, accountSet, eligibleAccounts, now, window) {
  const staged = db.select().from(simplefinAccounts).where(eq(simplefinAccounts.connectionId, connectionId)).all();
  const byRemoteId = new Map(staged.map((account) => [account.remoteAccountId, account]));
  let inserted = 0;
  let updated = 0;
  let pendingRetired = 0;

  for (const remoteAccount of accountSet.accounts) {
    const account = byRemoteId.get(String(remoteAccount?.id));
    if (!account || !eligibleAccounts.has(account.id) || !Array.isArray(remoteAccount.transactions)) continue;

    for (const transaction of remoteAccount.transactions) {
      if (transaction?.id == null || transaction?.posted == null || transaction?.amount == null) continue;
      const amount = String(transaction.amount);
      const timestamps = transactionTimestamps(transaction);
      const postedAt = timestamps.postedAt || (transaction.pending ? now : null);
      const { transactedAt } = timestamps;
      if (!postedAt || !MONEY_PATTERN.test(amount)) continue;
      const remoteTransactionId = String(transaction.id);
      let existing = db.select().from(simplefinTransactions).where(and(
        eq(simplefinTransactions.simplefinAccountId, account.id),
        eq(simplefinTransactions.remoteTransactionId, remoteTransactionId)
      )).get();
      if (!existing && !transaction.pending) {
        const stagedTransactions = db.select().from(simplefinTransactions)
          .where(eq(simplefinTransactions.simplefinAccountId, account.id)).all();
        existing = pendingReplacementCandidate(stagedTransactions, transaction);
      }
      const values = {
        simplefinAccountId: account.id,
        remoteTransactionId,
        postedAt,
        transactedAt,
        amount,
        description: String(transaction.description || 'Transaction').slice(0, 1000),
        pending: Boolean(transaction.pending),
        firstSeenAt: existing?.firstSeenAt || now,
        lastSeenAt: now,
        rawData: encryptCustomerValue(sqlite, userId, 'simplefin-transaction:raw', JSON.stringify({
          id: transaction.id,
          posted: transaction.posted,
          transacted_at: transaction.transacted_at,
          amount: transaction.amount,
          description: transaction.description,
          pending: Boolean(transaction.pending),
          extra: transaction.extra,
        })),
      };
      if (existing) {
        const changed = existing.postedAt !== values.postedAt
          || existing.transactedAt !== values.transactedAt
          || existing.amount !== values.amount
          || existing.description !== values.description
          || Boolean(existing.pending) !== values.pending;
        db.update(simplefinTransactions).set(values).where(eq(simplefinTransactions.id, existing.id)).run();
        if (changed) updated += 1;
      } else {
        db.insert(simplefinTransactions).values({ id: crypto.randomUUID(), ...values }).run();
        inserted += 1;
      }
    }
    const responseHasErrors = accountResponseHasErrors(accountSet, remoteAccount);
    if (!responseHasErrors) pendingRetired += retireMissingPendingTransactions(account.id, remoteAccount.transactions, window, now);
  }
  return { inserted, updated, pendingRetired };
}

function consecutiveFailureCount(connectionId, currentRunId) {
  const runs = db.select().from(simplefinSyncRuns)
    .where(eq(simplefinSyncRuns.connectionId, connectionId))
    .orderBy(desc(simplefinSyncRuns.startedAt)).all();
  let failures = 0;
  for (const run of runs) {
    if (run.id === currentRunId || run.status === 'running') continue;
    if (run.status !== 'failed') break;
    failures += 1;
  }
  return failures;
}

async function syncConnection(connectionId, userId, { scheduled = false } = {}) {
  const lock = acquireLock(connectionId, userId, scheduled ? 'automatic' : 'manual');
  let accessUrl;
  try {
    const links = db.select().from(financialAccountLinks).where(and(
      eq(financialAccountLinks.userId, userId),
      eq(financialAccountLinks.status, 'linked'),
      eq(financialAccountLinks.transactionSyncEnabled, true)
    )).all();
    const connectionAccounts = db.select().from(simplefinAccounts)
      .where(eq(simplefinAccounts.connectionId, connectionId)).all();
    const accountIds = new Set(connectionAccounts.map((account) => account.id));
    const eligibleLinks = links.filter((link) => accountIds.has(link.simplefinAccountId) && link.localAccountType !== 'trading');
    const connectionAccountsById = new Map(connectionAccounts.map(account => [account.id, account]));

    accessUrl = decryptAccessUrl(lock.connection.encryptedAccessUrl, lock.connection.encryptionKeyVersion, userId);
    const balanceSet = await fetchAccountSet(accessUrl, { balancesOnly: true });
    const warnings = providerWarnings(balanceSet);
    const now = new Date().toISOString();
    let accountsReceived = balanceSet.accounts.length;
    let transactionsInserted = 0;
    let transactionsUpdated = 0;
    let pendingTransactionsRetired = 0;
    const completedLinkIds = [];

    sqlite.transaction(() => updateRemoteAccounts(connectionId, userId, balanceSet, now))();

    const linkGroups = new Map();
    for (const link of eligibleLinks) {
      const start = transactionSyncStart(link).toISOString();
      const group = linkGroups.get(start) || [];
      group.push(link);
      linkGroups.set(start, group);
    }
    for (const [start, groupedLinks] of linkGroups) {
      const remoteAccounts = groupedLinks.map(link => connectionAccountsById.get(link.simplefinAccountId)).filter(Boolean);
      if (!remoteAccounts.length) continue;
      const groupedAccountIds = new Set(remoteAccounts.map(account => account.id));
      const windows = buildTransactionWindows(start, now);
      for (const window of windows) {
        const accountSet = await fetchAccountSet(accessUrl, {
          balancesOnly: false,
          startDate: window.startDate,
          endDate: window.endDate,
          includePending: true,
          accountIds: remoteAccounts.map(account => account.remoteAccountId),
        });
        warnings.push(...providerWarnings(accountSet));
        accountsReceived = Math.max(accountsReceived, accountSet.accounts.length);
        const counts = sqlite.transaction(() => upsertTransactions(connectionId, userId, accountSet, groupedAccountIds, now, window))();
        transactionsInserted += counts.inserted;
        transactionsUpdated += counts.updated;
        pendingTransactionsRetired += counts.pendingRetired;
      }
      completedLinkIds.push(...groupedLinks.map(link => link.id));
    }

    const materialized = materializeConnection(connectionId, userId);
    if (materialized.expensesMaterialized) {
      try { runSubscriptionDetection(userId); } catch (_) { /* Non-fatal derived-data refresh. */ }
    }
    try { reapplyTravelPlans(userId); } catch (_) { /* Non-fatal derived travel tags. */ }
    refreshCurrentNetWorth(userId);

    const completedAt = new Date().toISOString();
    const nextScheduledSyncAt = nextScheduleAfterSuccess(lock.connection, { scheduled, now: completedAt });
    const uniqueWarnings = deduplicateWarnings(warnings).slice(0, 50);
    const warningText = uniqueWarnings.length ? JSON.stringify(uniqueWarnings) : null;
    sqlite.transaction(() => {
      for (const linkId of completedLinkIds) {
        db.update(financialAccountLinks).set({ transactionSyncedThrough: completedAt.slice(0, 10) })
          .where(eq(financialAccountLinks.id, linkId)).run();
      }
      db.update(simplefinConnections).set({
        status: 'active',
        lastSyncSucceededAt: completedAt,
        nextSyncAllowedAt: new Date(Date.now() + HOUR_MS).toISOString(),
        nextScheduledSyncAt,
        lastError: warningText,
      }).where(eq(simplefinConnections.id, connectionId)).run();
      db.update(simplefinSyncRuns).set({
        completedAt,
        status: uniqueWarnings.length ? 'partial' : 'succeeded',
        accountsReceived,
        transactionsInserted,
        transactionsUpdated,
        expensesMaterialized: materialized.expensesMaterialized,
        duplicateCandidates: materialized.duplicateCandidates,
        warnings: warningText,
      }).where(eq(simplefinSyncRuns.id, lock.runId)).run();
    })();

    recordSimplefinSyncDigest(userId, {
      connectionId,
      accountsChecked: accountsReceived,
      transactionsUpdated: transactionsInserted + transactionsUpdated,
      expensesImported: materialized.expensesMaterialized,
      warningCount: uniqueWarnings.length,
      warnings: uniqueWarnings,
    }, new Date(completedAt));

    return {
      accountsReceived,
      transactionsInserted,
      transactionsUpdated,
      pendingTransactionsRetired,
      expensesMaterialized: materialized.expensesMaterialized,
      duplicateCandidates: materialized.duplicateCandidates,
      warnings: uniqueWarnings,
      completedAt,
    };
  } catch (error) {
    const safeMessage = sanitizeSimplefinError(error);
    const priorFailures = consecutiveFailureCount(connectionId, lock.runId);
    const backoffHours = Math.min(6, 2 ** priorFailures);
    const completedAt = new Date().toISOString();
    const nextAllowedAt = new Date(Date.now() + backoffHours * HOUR_MS).toISOString();
    const connectionStatus = error.code === 'access_revoked' ? 'reconnect_required' : 'active';
    sqlite.transaction(() => {
      db.update(simplefinConnections).set({
        status: connectionStatus,
        nextSyncAllowedAt: nextAllowedAt,
        nextScheduledSyncAt: nextAllowedAt,
        lastError: safeMessage,
      }).where(eq(simplefinConnections.id, connectionId)).run();
      db.update(simplefinSyncRuns).set({
        completedAt,
        status: 'failed',
        errorCode: String(error.code || 'sync_failed').slice(0, 80),
        errorSummary: safeMessage,
      }).where(eq(simplefinSyncRuns.id, lock.runId)).run();
    })();
    recordSimplefinSyncDigest(userId, { connectionId, failed: true }, new Date(completedAt));
    if (error instanceof SimplefinHttpError || error instanceof SimplefinSyncError) throw error;
    throw new SimplefinSyncError(safeMessage);
  } finally {
    accessUrl = null;
  }
}

module.exports = { accountResponseHasErrors, buildTransactionWindows, deduplicateWarnings, missingPendingTransactions, pendingReplacementCandidate, remoteAccountValues, transactionSyncStart, transactionTimestamps, syncConnection, SimplefinSyncError };
