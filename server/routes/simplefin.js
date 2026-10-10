const crypto = require('crypto');
const { Router } = require('express');
const { eq, and, desc, inArray } = require('drizzle-orm');
const rateLimit = require('express-rate-limit');
const { db, sqlite } = require('../db');
const {
  simplefinConnections,
  simplefinAccounts,
  simplefinSyncRuns,
  financialAccountLinks,
  creditCards,
  bankAccounts,
  tradingAccounts,
  simplefinTransactions,
  simplefinDuplicateCandidates,
  expenses,
} = require('../db/schema');
const { encryptAccessUrl, decryptAccessUrl } = require('../lib/simplefinCrypto');
const { encryptCustomerValue } = require('../lib/customerEncryption');
const { protectFinancialAccountData, revealFinancialAccountData } = require('../lib/customerDataFields');
const { sanitizeSimplefinError } = require('../lib/simplefinSecurity');
const { claimSetupToken, fetchAccountSet, SimplefinHttpError } = require('../lib/simplefinClient');
const { syncConnection, SimplefinSyncError } = require('../lib/simplefinSync');
const { materializeConnection, resolveDuplicate } = require('../lib/simplefinMaterialize');
const { runSubscriptionDetection } = require('../lib/subscriptionDetection');
const { scheduleFromBase } = require('../lib/simplefinSchedule');
const { refreshCurrentNetWorth } = require('../lib/netWorthProjection');
const { publicSyncRun } = require('../lib/simplefinAudit');
const { isImportedExpenseForTransactions } = require('../lib/simplefinDeletion');
const { revealExpenseRecord } = require('../lib/customerDataFields');
const { validatedImportDate } = require('../lib/simplefinImportRange');
const { summarizeTransactions } = require('../lib/simplefinTransactionSummary');
const { cleanId, hasOnlyKeys } = require('../middleware/inputValidation');
const { SqliteRateLimitStore } = require('../lib/sqliteRateLimitStore');

const router = Router();
const connectLimiter = rateLimit({
  store: new SqliteRateLimitStore('simplefin-connect'),
  keyGenerator: req => req.user.accountId,
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many SimpleFIN connection attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const syncLimiter = rateLimit({
  store: new SqliteRateLimitStore('simplefin-sync'),
  keyGenerator: req => req.user.accountId,
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many SimpleFIN sync attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function publicConnection(connection) {
  const recentRuns = db.select().from(simplefinSyncRuns)
    .where(eq(simplefinSyncRuns.connectionId, connection.id)).orderBy(desc(simplefinSyncRuns.startedAt)).all().slice(0, 10);
  const consecutiveFailures = recentRuns.findIndex(run => run.status !== 'failed');
  const failureCount = consecutiveFailures === -1 ? recentRuns.filter(run => run.status === 'failed').length : consecutiveFailures;
  return {
    id: connection.id,
    status: connection.status,
    createdAt: connection.createdAt,
    lastSyncStartedAt: connection.lastSyncStartedAt,
    lastSyncSucceededAt: connection.lastSyncSucceededAt,
    nextSyncAllowedAt: connection.nextSyncAllowedAt,
    autoSyncEnabled: connection.autoSyncEnabled,
    syncMinute: connection.syncMinute,
    nextScheduledSyncAt: connection.nextScheduledSyncAt,
    lastError: connection.lastError,
    consecutiveFailures: failureCount,
    needsAttention: failureCount >= 3 || connection.status === 'reconnect_required',
  };
}

function sanitizedProviderWarnings(accountSet) {
  const errors = Array.isArray(accountSet.errlist) ? accountSet.errlist : [];
  return errors.slice(0, 20).map((warning) => ({
    code: String(warning?.code || 'unknown').slice(0, 80),
    message: sanitizeSimplefinError(warning?.msg || 'SimpleFIN reported a warning'),
    accountId: warning?.account_id == null ? null : String(warning.account_id).slice(0, 500),
    connectionId: warning?.conn_id == null ? null : String(warning.conn_id).slice(0, 500),
  }));
}

function epochToIso(value) {
  const milliseconds = Number(value) * 1000;
  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stageDiscovery(connection, accountSet, startedAt, trigger = 'discovery') {
  const now = new Date().toISOString();
  const institutions = new Map((Array.isArray(accountSet.connections) ? accountSet.connections : [])
    .map((entry) => [String(entry?.conn_id || ''), entry?.org_name || entry?.name || null]));
  const warnings = sanitizedProviderWarnings(accountSet);
  const runId = crypto.randomUUID();

  sqlite.transaction(() => {
    for (const account of accountSet.accounts) {
      if (account?.id == null || account?.name == null || account?.currency == null || account?.balance == null) continue;
      const remoteAccountId = String(account.id);
      const existing = db.select().from(simplefinAccounts)
        .where(eq(simplefinAccounts.connectionId, connection.id)).all()
        .find((row) => row.remoteAccountId === remoteAccountId);
      const values = {
        id: existing?.id || crypto.randomUUID(),
        connectionId: connection.id,
        remoteAccountId,
        remoteConnectionId: account.conn_id == null ? null : String(account.conn_id),
        remoteName: String(account.name).slice(0, 500),
        institutionName: institutions.get(String(account.conn_id || '')) || null,
        currency: String(account.currency).slice(0, 40),
        balance: String(account.balance),
        availableBalance: account['available-balance'] == null ? null : String(account['available-balance']),
        balanceDate: epochToIso(account['balance-date']),
        isActive: true,
        firstSeenAt: existing?.firstSeenAt || now,
        lastSeenAt: now,
        rawData: encryptCustomerValue(sqlite, connection.userId, 'simplefin-account:raw', JSON.stringify({
          id: account.id,
          name: account.name,
          conn_id: account.conn_id,
          currency: account.currency,
          balance: account.balance,
          'available-balance': account['available-balance'],
          'balance-date': account['balance-date'],
          extra: account.extra,
        })),
      };
      if (existing) db.update(simplefinAccounts).set(values).where(eq(simplefinAccounts.id, existing.id)).run();
      else db.insert(simplefinAccounts).values(values).run();
    }

    const warningText = warnings.length ? JSON.stringify(warnings) : null;
    db.update(simplefinConnections).set({
      status: 'active',
      lastSyncStartedAt: startedAt,
      lastSyncSucceededAt: now,
      nextSyncAllowedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      lastError: warningText,
    }).where(eq(simplefinConnections.id, connection.id)).run();
    db.insert(simplefinSyncRuns).values({
      id: runId,
      connectionId: connection.id,
      startedAt,
      completedAt: now,
      status: warnings.length ? 'partial' : 'succeeded',
      trigger,
      accountsReceived: accountSet.accounts.length,
      warnings: warningText,
    }).run();
  })();

  return { accountsDiscovered: accountSet.accounts.length, warnings };
}

const localAccountTables = {
  credit_card: creditCards,
  bank: bankAccounts,
  trading: tradingAccounts,
};

function ownedSimplefinAccount(userId, simplefinAccountId) {
  const account = db.select().from(simplefinAccounts).where(eq(simplefinAccounts.id, simplefinAccountId)).get();
  if (!account) return null;
  const connection = db.select().from(simplefinConnections)
    .where(and(eq(simplefinConnections.id, account.connectionId), eq(simplefinConnections.userId, userId))).get();
  return connection ? account : null;
}

function ownedLocalAccount(userId, type, id, activeOnly = false) {
  const table = localAccountTables[type];
  if (!table || typeof id !== 'string' || !id) return null;
  const account = db.select().from(table).where(and(eq(table.id, id), eq(table.userId, userId))).get() || null;
  return activeOnly && account?.isActive === false ? null : account;
}

function localAccountName(userId, link) {
  const account = ownedLocalAccount(userId, link.localAccountType, link.localAccountId);
  if (!account) return 'Manual account';
  let metadata = {};
  try { metadata = JSON.parse(revealFinancialAccountData(sqlite, userId, link.localAccountType, account.data) || '{}'); } catch { /* Keep the stored base name. */ }
  if (link.localAccountType === 'bank') return metadata.bankName || account.name || 'Bank account';
  if (link.localAccountType === 'trading') return metadata.brokerName || account.name || 'Trading account';
  if (link.localAccountType === 'credit_card') return metadata.nickname || account.name || 'Credit card';
  return account.name || 'Manual account';
}

router.get('/connections', (req, res) => {
  const connections = db.select().from(simplefinConnections)
    .where(eq(simplefinConnections.userId, req.user.accountId))
    .orderBy(desc(simplefinConnections.createdAt)).all();
  res.json({ connections: connections.map(publicConnection) });
});

router.get('/sync-runs', (req, res) => {
  const connections = db.select({ id: simplefinConnections.id }).from(simplefinConnections)
    .where(eq(simplefinConnections.userId, req.user.accountId)).all();
  if (!connections.length) return res.json({ runs: [] });

  const ownedIds = connections.map(({ id }) => id);
  const requestedConnectionId = typeof req.query.connectionId === 'string' ? req.query.connectionId : null;
  if (requestedConnectionId && !ownedIds.includes(requestedConnectionId)) {
    return res.status(404).json({ error: 'SimpleFIN connection not found' });
  }
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 100);
  const runs = db.select().from(simplefinSyncRuns)
    .where(requestedConnectionId
      ? eq(simplefinSyncRuns.connectionId, requestedConnectionId)
      : inArray(simplefinSyncRuns.connectionId, ownedIds))
    .orderBy(desc(simplefinSyncRuns.startedAt)).limit(limit).all();
  return res.json({ runs: runs.map(publicSyncRun) });
});

router.get('/accounts', (req, res) => {
  const connections = db.select({ id: simplefinConnections.id }).from(simplefinConnections)
    .where(eq(simplefinConnections.userId, req.user.accountId)).all();
  if (!connections.length) return res.json({ accounts: [] });

  const accounts = db.select({
    id: simplefinAccounts.id,
    connectionId: simplefinAccounts.connectionId,
    remoteName: simplefinAccounts.remoteName,
    institutionName: simplefinAccounts.institutionName,
    currency: simplefinAccounts.currency,
    balance: simplefinAccounts.balance,
    availableBalance: simplefinAccounts.availableBalance,
    balanceDate: simplefinAccounts.balanceDate,
    isActive: simplefinAccounts.isActive,
    firstSeenAt: simplefinAccounts.firstSeenAt,
    lastSeenAt: simplefinAccounts.lastSeenAt,
  }).from(simplefinAccounts)
    .where(inArray(simplefinAccounts.connectionId, connections.map(({ id }) => id)))
    .all();
  const links = db.select().from(financialAccountLinks)
    .where(and(
      eq(financialAccountLinks.userId, req.user.accountId),
      eq(financialAccountLinks.status, 'linked')
    )).all();
  const linksByAccount = new Map(links.map((link) => [link.simplefinAccountId, link]));
  const stagedTransactions = accounts.length
    ? db.select().from(simplefinTransactions)
      .where(inArray(simplefinTransactions.simplefinAccountId, accounts.map(({ id }) => id))).all()
    : [];
  const transactionsByAccount = new Map();
  for (const transaction of stagedTransactions) {
    const rows = transactionsByAccount.get(transaction.simplefinAccountId) || [];
    rows.push(transaction);
    transactionsByAccount.set(transaction.simplefinAccountId, rows);
  }

  return res.json({
    accounts: accounts.map((account) => {
      const link = linksByAccount.get(account.id);
      return {
        ...account,
        transactionSummary: summarizeTransactions(transactionsByAccount.get(account.id) || []),
        link: link ? {
          id: link.id,
          linkedAt: link.linkedAt,
          transactionImportFrom: link.transactionImportFrom,
          transactionSyncedThrough: link.transactionSyncedThrough,
          localAccount: {
            type: link.localAccountType,
            id: link.localAccountId,
            name: localAccountName(req.user.accountId, link),
          },
        } : null,
      };
    }),
  });
});

router.post('/accounts/:id/link', (req, res) => {
  const userId = req.user.accountId;
  const simplefinAccount = ownedSimplefinAccount(userId, req.params.id);
  if (!simplefinAccount) return res.status(404).json({ error: 'SimpleFIN account not found' });

  const type = req.body?.localAccount?.type;
  if (!hasOnlyKeys(req.body, ['localAccount', 'importFrom']) || !hasOnlyKeys(req.body?.localAccount, ['type', 'id'])) {
    return res.status(400).json({ error: 'Unsupported account-link field.' });
  }
  const validatedId = cleanId(req.body?.localAccount?.id, 'Manual account identifier');
  if (validatedId.error) return res.status(400).json({ error: validatedId.error });
  const id = validatedId.value;
  const localAccount = ownedLocalAccount(userId, type, id, true);
  if (!localAccount) return res.status(400).json({ error: 'Select a valid manual account' });
  const importFrom = validatedImportDate(req.body?.importFrom || new Date().toISOString().slice(0, 10));
  if (!importFrom) return res.status(400).json({ error: 'Choose a valid import date within the last two years.' });

  const remoteLink = db.select().from(financialAccountLinks).where(and(
    eq(financialAccountLinks.simplefinAccountId, simplefinAccount.id),
    eq(financialAccountLinks.status, 'linked')
  )).get();
  if (remoteLink) return res.status(409).json({ error: 'This SimpleFIN account is already linked' });

  const localLink = db.select().from(financialAccountLinks).where(and(
    eq(financialAccountLinks.userId, userId),
    eq(financialAccountLinks.localAccountType, type),
    eq(financialAccountLinks.localAccountId, id),
    eq(financialAccountLinks.status, 'linked')
  )).get();
  if (localLink) return res.status(409).json({ error: 'That manual account is already linked to another SimpleFIN account' });

  const now = new Date().toISOString();
  const link = {
    id: crypto.randomUUID(),
    userId,
    simplefinAccountId: simplefinAccount.id,
    localAccountType: type,
    localAccountId: id,
    status: 'linked',
    balanceSource: 'simplefin',
    transactionSyncEnabled: true,
    transactionImportFrom: importFrom,
    createdAt: now,
    linkedAt: now,
  };
  try {
    db.insert(financialAccountLinks).values(link).run();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'One of these accounts was linked by another request. Refresh and try again.' });
    }
    throw error;
  }

  return res.status(201).json({
    link: {
      id: link.id,
      linkedAt: link.linkedAt,
      transactionImportFrom: link.transactionImportFrom,
      localAccount: { type, id, name: localAccount.name },
    },
  });
});

router.post('/accounts/:id/create-and-link', (req, res) => {
  const userId = req.user.accountId;
  const simplefinAccount = ownedSimplefinAccount(userId, req.params.id);
  if (!simplefinAccount) return res.status(404).json({ error: 'SimpleFIN account not found' });
  if (!simplefinAccount.isActive) return res.status(409).json({ error: 'This SimpleFIN account is no longer active' });

  const type = req.body?.type;
  const table = localAccountTables[type];
  if (!table) return res.status(400).json({ error: 'Choose whether this is a bank, credit-card, or trading account.' });
  const importFrom = validatedImportDate(req.body?.importFrom || new Date().toISOString().slice(0, 10));
  if (!importFrom) return res.status(400).json({ error: 'Choose a valid import date within the last two years.' });

  const activeLink = db.select().from(financialAccountLinks).where(and(
    eq(financialAccountLinks.simplefinAccountId, simplefinAccount.id),
    eq(financialAccountLinks.status, 'linked')
  )).get();
  if (activeLink) return res.status(409).json({ error: 'This SimpleFIN account is already linked' });

  const localId = crypto.randomUUID();
  const linkId = crypto.randomUUID();
  const now = new Date().toISOString();
  const displayName = String(simplefinAccount.remoteName || 'Connected account').trim().slice(0, 100) || 'Connected account';
  const localData = type === 'credit_card'
    ? { nickname: displayName, institution: simplefinAccount.institutionName }
    : type === 'bank'
      ? { bankName: displayName, institution: simplefinAccount.institutionName, balance: Number(simplefinAccount.balance) || 0 }
      : { brokerName: displayName, institution: simplefinAccount.institutionName, balance: Number(simplefinAccount.balance) || 0 };

  try {
    sqlite.transaction(() => {
      db.insert(table).values({ id: localId, userId, name: displayName, data: protectFinancialAccountData(sqlite, userId, type, JSON.stringify(localData)) }).run();
      db.insert(financialAccountLinks).values({
        id: linkId,
        userId,
        simplefinAccountId: simplefinAccount.id,
        localAccountType: type,
        localAccountId: localId,
        status: 'linked',
        balanceSource: 'simplefin',
        transactionSyncEnabled: true,
        transactionImportFrom: importFrom,
        createdAt: now,
        linkedAt: now,
      }).run();
    })();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'This account was linked by another request. Refresh and try again.' });
    }
    throw error;
  }

  try { refreshCurrentNetWorth(userId); } catch (_) { /* Non-fatal derived-data refresh. */ }
  return res.status(201).json({
    account: { id: localId, type, name: displayName },
    link: {
      id: linkId,
      linkedAt: now,
      transactionImportFrom: importFrom,
      localAccount: { type, id: localId, name: displayName },
    },
  });
});

router.patch('/accounts/:id/import-range', (req, res) => {
  const userId = req.user.accountId;
  const simplefinAccount = ownedSimplefinAccount(userId, req.params.id);
  if (!simplefinAccount) return res.status(404).json({ error: 'SimpleFIN account not found' });
  const importFrom = validatedImportDate(req.body?.importFrom);
  if (!importFrom) return res.status(400).json({ error: 'Choose a valid import date within the last two years.' });
  const link = db.select().from(financialAccountLinks).where(and(
    eq(financialAccountLinks.userId, userId),
    eq(financialAccountLinks.simplefinAccountId, simplefinAccount.id),
    eq(financialAccountLinks.status, 'linked')
  )).get();
  if (!link) return res.status(404).json({ error: 'Link this account before changing its import range.' });
  const backfillRequested = importFrom < (link.transactionImportFrom || importFrom);
  db.update(financialAccountLinks).set({
    transactionImportFrom: importFrom,
    ...(backfillRequested ? { transactionSyncedThrough: null } : {}),
  })
    .where(eq(financialAccountLinks.id, link.id)).run();
  return res.json({ importFrom, backfillRequested });
});

router.delete('/accounts/:id/link', (req, res) => {
  const userId = req.user.accountId;
  const simplefinAccount = ownedSimplefinAccount(userId, req.params.id);
  if (!simplefinAccount) return res.status(404).json({ error: 'SimpleFIN account not found' });

  const link = db.select().from(financialAccountLinks).where(and(
    eq(financialAccountLinks.userId, userId),
    eq(financialAccountLinks.simplefinAccountId, simplefinAccount.id),
    eq(financialAccountLinks.status, 'linked')
  )).get();
  if (!link) return res.status(404).json({ error: 'This account is not linked' });

  db.update(financialAccountLinks).set({
    status: 'unlinked',
    transactionSyncEnabled: false,
    unlinkedAt: new Date().toISOString(),
  }).where(eq(financialAccountLinks.id, link.id)).run();
  return res.json({ unlinked: true });
});

router.get('/duplicates', (req, res) => {
  const candidates = db.select().from(simplefinDuplicateCandidates).where(and(
    eq(simplefinDuplicateCandidates.userId, req.user.accountId),
    eq(simplefinDuplicateCandidates.status, 'pending')
  )).all();
  const result = candidates.map((candidate) => {
    const transaction = db.select().from(simplefinTransactions)
      .where(eq(simplefinTransactions.id, candidate.simplefinTransactionId)).get();
    const remoteAccount = transaction ? db.select().from(simplefinAccounts)
      .where(eq(simplefinAccounts.id, transaction.simplefinAccountId)).get() : null;
    const link = remoteAccount ? db.select().from(financialAccountLinks).where(and(
      eq(financialAccountLinks.userId, req.user.accountId),
      eq(financialAccountLinks.simplefinAccountId, remoteAccount.id),
      eq(financialAccountLinks.status, 'linked')
    )).get() : null;
    const storedManualExpense = candidate.possibleExpenseId ? db.select().from(expenses)
      .where(eq(expenses.id, candidate.possibleExpenseId)).get() : null;
    const manualExpense = storedManualExpense ? revealExpenseRecord(sqlite, storedManualExpense) : null;
    if (!transaction || !remoteAccount || !link) return null;
    return {
      id: candidate.id,
      score: candidate.score,
      createdAt: candidate.createdAt,
      account: {
        name: remoteAccount.remoteName,
        linkedTo: localAccountName(req.user.accountId, link),
      },
      providerTransaction: {
        description: transaction.description,
        amount: Math.abs(Number(transaction.amount)),
        date: transaction.postedAt.slice(0, 10),
        currency: remoteAccount.currency,
      },
      possibleManualExpense: manualExpense ? {
        id: manualExpense.id,
        description: manualExpense.description,
        amount: manualExpense.amount,
        date: manualExpense.date,
      } : null,
    };
  }).filter(Boolean);
  return res.json({ duplicates: result });
});

router.get('/classification-reviews', (req, res) => {
  const connections = db.select({ id: simplefinConnections.id }).from(simplefinConnections)
    .where(eq(simplefinConnections.userId, req.user.accountId)).all();
  if (!connections.length) return res.json({ reviews: [] });
  const remoteAccounts = db.select().from(simplefinAccounts)
    .where(inArray(simplefinAccounts.connectionId, connections.map(({ id }) => id))).all();
  if (!remoteAccounts.length) return res.json({ reviews: [] });
  const accountsById = new Map(remoteAccounts.map(account => [account.id, account]));
  const reviews = db.select().from(simplefinTransactions)
    .where(and(
      inArray(simplefinTransactions.simplefinAccountId, remoteAccounts.map(({ id }) => id)),
      eq(simplefinTransactions.classification, 'review')
    )).all();
  return res.json({
    reviews: reviews.map(transaction => {
      const remoteAccount = accountsById.get(transaction.simplefinAccountId);
      return {
        id: transaction.id,
        description: transaction.description,
        amount: transaction.amount,
        postedAt: transaction.postedAt,
        reason: transaction.classificationReason,
        account: { id: remoteAccount.id, name: remoteAccount.remoteName, currency: remoteAccount.currency },
      };
    }),
  });
});

router.patch('/classification-reviews/:id', (req, res) => {
  const allowed = new Set(['expense', 'income', 'transfer', 'card_payment', 'refund', 'ignored']);
  const classification = req.body?.classification;
  if (!allowed.has(classification)) return res.status(400).json({ error: 'Choose a valid transaction classification.' });
  const transaction = db.select().from(simplefinTransactions)
    .where(eq(simplefinTransactions.id, req.params.id)).get();
  const remoteAccount = transaction ? ownedSimplefinAccount(req.user.accountId, transaction.simplefinAccountId) : null;
  if (!transaction || !remoteAccount) return res.status(404).json({ error: 'Transaction review not found' });
  db.update(simplefinTransactions).set({
    classification,
    classificationSource: 'user',
    classificationReason: 'Classified by user.',
  }).where(eq(simplefinTransactions.id, transaction.id)).run();
  const materialized = materializeConnection(remoteAccount.connectionId, req.user.accountId);
  try { runSubscriptionDetection(req.user.accountId); } catch (_) { /* Non-fatal derived-data refresh. */ }
  return res.json({ classification, ...materialized });
});

router.post('/duplicates/:id/resolve', (req, res) => {
  try {
    const result = resolveDuplicate(req.params.id, req.user.accountId, req.body?.action);
    if (result.action === 'import_separately') {
      try { runSubscriptionDetection(req.user.accountId); } catch (_) { /* Non-fatal derived-data refresh. */ }
    }
    return res.json(result);
  } catch (error) {
    const message = sanitizeSimplefinError(error);
    const status = message === 'Duplicate candidate not found' ? 404 : 400;
    return res.status(status).json({ error: message });
  }
});

router.post('/connections', connectLimiter, async (req, res) => {
  if (!req.user.accountId) return res.status(400).json({ error: 'A budget account is required to connect SimpleFIN' });
  const setupToken = req.body?.setupToken;
  if (typeof setupToken !== 'string' || !setupToken.trim() || setupToken.length > 4096) {
    return res.status(400).json({ error: 'setupToken is required' });
  }

  let connection;
  let accessUrl;
  const startedAt = new Date().toISOString();
  try {
    accessUrl = await claimSetupToken(setupToken.trim());
    const encrypted = encryptAccessUrl(accessUrl, req.user.accountId);
    connection = {
      id: crypto.randomUUID(),
      userId: req.user.accountId,
      ...encrypted,
      status: 'syncing',
      createdAt: startedAt,
      lastSyncStartedAt: startedAt,
      autoSyncEnabled: true,
      syncMinute: crypto.randomInt(0, 60),
    };
    connection.nextScheduledSyncAt = scheduleFromBase(startedAt, connection.syncMinute, startedAt);
    db.insert(simplefinConnections).values(connection).run();

    const accountSet = await fetchAccountSet(accessUrl, { balancesOnly: true });
    const discovery = stageDiscovery(connection, accountSet, startedAt);
    const saved = db.select().from(simplefinConnections).where(eq(simplefinConnections.id, connection.id)).get();
    return res.status(201).json({ connection: publicConnection(saved), ...discovery });
  } catch (error) {
    const safeMessage = sanitizeSimplefinError(error);
    if (connection) {
      const status = error.code === 'access_revoked' ? 'reconnect_required' : 'active';
      const completedAt = new Date().toISOString();
      sqlite.transaction(() => {
        db.update(simplefinConnections).set({ status, lastError: safeMessage })
          .where(eq(simplefinConnections.id, connection.id)).run();
        db.insert(simplefinSyncRuns).values({
          id: crypto.randomUUID(),
          connectionId: connection.id,
          startedAt,
          completedAt,
          status: 'failed',
          trigger: 'discovery',
          errorCode: String(error.code || 'discovery_failed').slice(0, 80),
          errorSummary: safeMessage,
        }).run();
      })();
      const saved = db.select().from(simplefinConnections).where(eq(simplefinConnections.id, connection.id)).get();
      return res.status(502).json({
        error: 'SimpleFIN was connected, but account discovery failed. Your credential was saved safely; try syncing again later.',
        connection: publicConnection(saved),
      });
    }

    const statusCode = error instanceof SimplefinHttpError ? error.statusCode : 500;
    return res.status(statusCode).json({ error: safeMessage });
  } finally {
    accessUrl = null;
  }
});

router.post('/connections/:id/discover', connectLimiter, async (req, res) => {
  const connection = db.select().from(simplefinConnections)
    .where(eq(simplefinConnections.id, req.params.id)).get();
  if (!connection || connection.userId !== req.user.accountId) {
    return res.status(404).json({ error: 'SimpleFIN connection not found' });
  }
  const syncStartedAt = connection.lastSyncStartedAt ? new Date(connection.lastSyncStartedAt).getTime() : 0;
  if (connection.status === 'syncing' && Date.now() - syncStartedAt < 15 * 60 * 1000) {
    return res.status(409).json({ error: 'This SimpleFIN connection is already syncing' });
  }
  if (connection.nextSyncAllowedAt && connection.nextSyncAllowedAt > new Date().toISOString()) {
    return res.status(429).json({
      error: 'This connection was synced recently. Try again after the next permitted sync time.',
      nextSyncAllowedAt: connection.nextSyncAllowedAt,
    });
  }

  const startedAt = new Date().toISOString();
  let accessUrl;
  try {
    db.update(simplefinConnections).set({ status: 'syncing', lastSyncStartedAt: startedAt })
      .where(eq(simplefinConnections.id, connection.id)).run();
    accessUrl = decryptAccessUrl(connection.encryptedAccessUrl, connection.encryptionKeyVersion, req.user.accountId);
    const accountSet = await fetchAccountSet(accessUrl, { balancesOnly: true });
    const discovery = stageDiscovery(connection, accountSet, startedAt);
    const saved = db.select().from(simplefinConnections).where(eq(simplefinConnections.id, connection.id)).get();
    return res.json({ connection: publicConnection(saved), ...discovery });
  } catch (error) {
    const safeMessage = sanitizeSimplefinError(error);
    const status = error.code === 'access_revoked' ? 'reconnect_required' : 'active';
    const completedAt = new Date().toISOString();
    sqlite.transaction(() => {
      db.update(simplefinConnections).set({ status, lastError: safeMessage })
        .where(eq(simplefinConnections.id, connection.id)).run();
      db.insert(simplefinSyncRuns).values({
        id: crypto.randomUUID(),
        connectionId: connection.id,
        startedAt,
        completedAt,
        status: 'failed',
        trigger: 'discovery',
        errorCode: String(error.code || 'discovery_failed').slice(0, 80),
        errorSummary: safeMessage,
      }).run();
    })();
    return res.status(error instanceof SimplefinHttpError ? error.statusCode : 500).json({ error: safeMessage });
  } finally {
    accessUrl = null;
  }
});

router.post('/connections/:id/sync', syncLimiter, async (req, res) => {
  req.telemetryCounters?.add('simplefin_sync=1');
  try {
    const result = await syncConnection(req.params.id, req.user.accountId);
    if (result.pendingTransactionsRetired) req.telemetryCounters?.add(`pending_transactions_retired=${result.pendingTransactionsRetired}`);
    const saved = db.select().from(simplefinConnections)
      .where(and(
        eq(simplefinConnections.id, req.params.id),
        eq(simplefinConnections.userId, req.user.accountId)
      )).get();
    return res.json({ connection: publicConnection(saved), ...result });
  } catch (error) {
    const safeMessage = sanitizeSimplefinError(error);
    const statusCode = error instanceof SimplefinHttpError || error instanceof SimplefinSyncError
      ? error.statusCode : 500;
    return res.status(statusCode).json({
      error: safeMessage,
      ...(error.nextSyncAllowedAt ? { nextSyncAllowedAt: error.nextSyncAllowedAt } : {}),
    });
  }
});

router.patch('/connections/:id/auto-sync', (req, res) => {
  if (!hasOnlyKeys(req.body, ['enabled'])) return res.status(400).json({ error: 'Unsupported automatic-sync field.' });
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be true or false' });
  }
  const connection = db.select().from(simplefinConnections).where(and(
    eq(simplefinConnections.id, req.params.id),
    eq(simplefinConnections.userId, req.user.accountId)
  )).get();
  if (!connection) return res.status(404).json({ error: 'SimpleFIN connection not found' });
  if (connection.status !== 'active') {
    return res.status(409).json({ error: 'Reconnect this SimpleFIN connection before enabling automatic sync.' });
  }

  const nextScheduledSyncAt = req.body.enabled
    ? scheduleFromBase(new Date(), connection.syncMinute, new Date())
    : null;
  db.update(simplefinConnections).set({
    autoSyncEnabled: req.body.enabled,
    nextScheduledSyncAt,
  }).where(eq(simplefinConnections.id, connection.id)).run();
  const saved = db.select().from(simplefinConnections).where(eq(simplefinConnections.id, connection.id)).get();
  return res.json({ connection: publicConnection(saved) });
});

router.delete('/connections/:id', (req, res) => {
  const connection = db.select().from(simplefinConnections).where(and(
    eq(simplefinConnections.id, req.params.id),
    eq(simplefinConnections.userId, req.user.accountId)
  )).get();
  if (!connection) return res.status(404).json({ error: 'SimpleFIN connection not found' });
  const syncStartedAt = connection.lastSyncStartedAt ? new Date(connection.lastSyncStartedAt).getTime() : 0;
  if (connection.status === 'syncing' && Date.now() - syncStartedAt < 15 * 60 * 1000) {
    return res.status(409).json({ error: 'Wait for the active sync to finish before disconnecting.' });
  }

  // Replace the credential rather than retaining a usable revoked secret. The
  // staging records, links, expenses and audit history remain untouched.
  const destroyed = encryptAccessUrl('https://disconnected.invalid/simplefin', req.user.accountId);
  db.update(simplefinConnections).set({
    ...destroyed,
    status: 'disabled',
    autoSyncEnabled: false,
    nextScheduledSyncAt: null,
    nextSyncAllowedAt: null,
    lastError: null,
  }).where(eq(simplefinConnections.id, connection.id)).run();
  refreshCurrentNetWorth(req.user.accountId);
  const saved = db.select().from(simplefinConnections).where(eq(simplefinConnections.id, connection.id)).get();
  return res.json({ connection: publicConnection(saved), disconnected: true });
});

router.delete('/connections/:id/data', (req, res) => {
  const connection = db.select().from(simplefinConnections).where(and(
    eq(simplefinConnections.id, req.params.id),
    eq(simplefinConnections.userId, req.user.accountId)
  )).get();
  if (!connection) return res.status(404).json({ error: 'SimpleFIN connection not found' });
  if (connection.status !== 'disabled') {
    return res.status(409).json({ error: 'Disconnect this SimpleFIN connection before permanently deleting its data.' });
  }
  if (req.body?.confirmation !== 'DELETE') {
    return res.status(400).json({ error: 'Type DELETE to confirm permanent deletion.' });
  }

  const remoteAccounts = db.select().from(simplefinAccounts)
    .where(eq(simplefinAccounts.connectionId, connection.id)).all();
  const remoteAccountIds = remoteAccounts.map(({ id }) => id);
  const transactions = remoteAccountIds.length
    ? db.select().from(simplefinTransactions)
      .where(inArray(simplefinTransactions.simplefinAccountId, remoteAccountIds)).all()
    : [];
  const transactionIds = new Set(transactions.map(({ id }) => id));
  const importedExpenseIds = [...new Set(transactions.map(({ expenseId }) => expenseId).filter(Boolean))]
    .filter((expenseId) => {
      const expense = db.select().from(expenses).where(eq(expenses.id, expenseId)).get();
      return isImportedExpenseForTransactions(expense, transactionIds);
    });
  const runCount = db.select().from(simplefinSyncRuns)
    .where(eq(simplefinSyncRuns.connectionId, connection.id)).all().length;
  const duplicateCount = transactionIds.size
    ? db.select().from(simplefinDuplicateCandidates)
      .where(inArray(simplefinDuplicateCandidates.simplefinTransactionId, [...transactionIds])).all().length
    : 0;
  const linkCount = remoteAccountIds.length
    ? db.select().from(financialAccountLinks)
      .where(inArray(financialAccountLinks.simplefinAccountId, remoteAccountIds)).all().length
    : 0;

  sqlite.transaction(() => {
    for (const expenseId of importedExpenseIds) {
      db.delete(expenses).where(eq(expenses.id, expenseId)).run();
    }
    db.delete(simplefinConnections).where(eq(simplefinConnections.id, connection.id)).run();
  })();

  try { runSubscriptionDetection(req.user.accountId); } catch (_) { /* Non-fatal derived-data refresh. */ }
  refreshCurrentNetWorth(req.user.accountId);
  return res.json({
    deleted: true,
    counts: {
      accounts: remoteAccounts.length,
      links: linkCount,
      transactions: transactions.length,
      importedExpenses: importedExpenseIds.length,
      duplicateReviews: duplicateCount,
      syncRuns: runCount,
    },
  });
});

router.post('/connections/:id/reconnect', connectLimiter, async (req, res) => {
  const connection = db.select().from(simplefinConnections).where(and(
    eq(simplefinConnections.id, req.params.id),
    eq(simplefinConnections.userId, req.user.accountId)
  )).get();
  if (!connection) return res.status(404).json({ error: 'SimpleFIN connection not found' });
  if (!['disabled', 'reconnect_required', 'revoked'].includes(connection.status)) {
    return res.status(409).json({ error: 'This connection does not currently require reconnection.' });
  }
  const setupToken = req.body?.setupToken;
  if (typeof setupToken !== 'string' || !setupToken.trim() || setupToken.length > 4096) {
    return res.status(400).json({ error: 'setupToken is required' });
  }

  const startedAt = new Date().toISOString();
  let accessUrl;
  let credentialSaved = false;
  try {
    accessUrl = await claimSetupToken(setupToken.trim());
    const encrypted = encryptAccessUrl(accessUrl, req.user.accountId);
    const syncMinute = Number.isInteger(connection.syncMinute) ? connection.syncMinute : crypto.randomInt(0, 60);
    db.update(simplefinConnections).set({
      ...encrypted,
      status: 'syncing',
      autoSyncEnabled: true,
      syncMinute,
      lastSyncStartedAt: startedAt,
      nextSyncAllowedAt: null,
      nextScheduledSyncAt: scheduleFromBase(startedAt, syncMinute, startedAt),
      lastError: null,
    }).where(eq(simplefinConnections.id, connection.id)).run();
    credentialSaved = true;

    const accountSet = await fetchAccountSet(accessUrl, { balancesOnly: true });
    const current = db.select().from(simplefinConnections).where(eq(simplefinConnections.id, connection.id)).get();
    const discovery = stageDiscovery(current, accountSet, startedAt, 'reconnect');
    refreshCurrentNetWorth(req.user.accountId);
    const saved = db.select().from(simplefinConnections).where(eq(simplefinConnections.id, connection.id)).get();
    return res.json({ connection: publicConnection(saved), ...discovery, reconnected: true });
  } catch (error) {
    const safeMessage = sanitizeSimplefinError(error);
    if (credentialSaved) {
      const status = error.code === 'access_revoked' ? 'reconnect_required' : 'active';
      const completedAt = new Date().toISOString();
      sqlite.transaction(() => {
        db.update(simplefinConnections).set({ status, lastError: safeMessage })
          .where(eq(simplefinConnections.id, connection.id)).run();
        db.insert(simplefinSyncRuns).values({
          id: crypto.randomUUID(), connectionId: connection.id, startedAt, completedAt,
          status: 'failed', trigger: 'reconnect',
          errorCode: String(error.code || 'reconnect_discovery_failed').slice(0, 80),
          errorSummary: safeMessage,
        }).run();
      })();
      return res.status(502).json({
        error: 'The new credential was saved, but account discovery failed. Try Sync now later.',
        connection: publicConnection(db.select().from(simplefinConnections).where(eq(simplefinConnections.id, connection.id)).get()),
      });
    }
    const statusCode = error instanceof SimplefinHttpError ? error.statusCode : 500;
    return res.status(statusCode).json({ error: safeMessage });
  } finally {
    accessUrl = null;
  }
});

module.exports = router;
