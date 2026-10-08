const crypto = require('crypto');
const { eq, and } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const {
  financialAccountLinks,
  simplefinAccounts,
  simplefinTransactions,
  simplefinDuplicateCandidates,
  monthlySpending,
  expenses,
  categories,
  categoryRules,
  financialProfiles,
  creditCards,
  bankAccounts,
  tradingAccounts,
} = require('../db/schema');
const { classifyTransaction } = require('./simplefinClassification');
const { convertCurrency, ratesForDate } = require('./fxRates');
const { normalizeMerchant } = require('./merchantRules');
const { protectExpenseRecord, revealExpenseData, revealExpenseRecord } = require('./customerDataFields');
const { ruleMatchesPurchase } = require('./categoryRuleApplication');
const { normalizedCategoryName } = require('./categoryValidation');
const { isUncategorized, normalizeExpenseCategories } = require('./expenseCategories');
const { decryptCustomerValue } = require('./customerEncryption');
const { extractProviderCategories } = require('./simplefinProviderCategories');

const PROVIDER_CATEGORY_COLORS = ['#28a745', '#007bff', '#dc3545', '#ffc107', '#17a2b8', '#6f42c1', '#fd7e14'];

function normalizeDescription(value) {
  return normalizeMerchant(value);
}

function descriptionSimilarity(left, right) {
  const a = normalizeDescription(left);
  const b = normalizeDescription(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  return intersection / new Set([...aTokens, ...bTokens]).size;
}

function decimalToCents(value) {
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = `${match[3] || ''}00`.slice(0, 2);
  const roundedDigit = Number((match[3] || '')[2] || 0);
  let cents = BigInt(match[2]) * 100n + BigInt(fraction);
  if (roundedDigit >= 5) cents += 1n;
  return match[1] ? -cents : cents;
}

function expenseData(expense) {
  try {
    const plaintext = revealExpenseData(sqlite, expense);
    return plaintext ? JSON.parse(plaintext) : {};
  } catch { return {}; }
}

function dayDistance(left, right) {
  const a = Date.parse(`${String(left).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(right).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b) / (24 * 60 * 60 * 1000);
}

function transactionActivityAt(transaction) {
  return transaction.transactedAt || transaction.postedAt;
}

function findProbableDuplicate(userId, link, transaction) {
  const providerCents = decimalToCents(transaction.amount);
  if (providerCents == null) return null;
  const spendingRows = db.select().from(monthlySpending).where(and(
    eq(monthlySpending.userId, userId),
    eq(monthlySpending.cardId, link.localAccountId)
  )).all();
  let best = null;

  for (const spending of spendingRows) {
    for (const stored of db.select().from(expenses).where(eq(expenses.spendingId, spending.id)).all()) {
      if (stored.hiddenAt) continue;
      const expense = revealExpenseRecord(sqlite, stored);
      if (expenseData(expense).source === 'simplefin') continue;
      const manualAmount = Number(expense.amount);
      if (!Number.isFinite(manualAmount)) continue;
      const manualCents = BigInt(Math.round(Math.abs(manualAmount) * 100));
      if (-providerCents !== manualCents) continue;
      const days = dayDistance(transactionActivityAt(transaction), expense.date);
      if (days > 1) continue;
      const similarity = descriptionSimilarity(transaction.description, expense.description);
      const score = 0.5 + (days === 0 ? 0.2 : 0.15) + similarity * 0.3;
      if (!best || score > best.score) best = { expense, score };
    }
  }
  return best;
}

function ensureMonthlySpending(userId, link, transaction) {
  const date = new Date(transactionActivityAt(transaction));
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  let spending = db.select().from(monthlySpending).where(and(
    eq(monthlySpending.userId, userId),
    eq(monthlySpending.year, year),
    eq(monthlySpending.month, month),
    eq(monthlySpending.cardId, link.localAccountId)
  )).get();
  if (!spending) {
    spending = { id: crypto.randomUUID(), userId, year, month, cardId: link.localAccountId };
    db.insert(monthlySpending).values(spending).run();
  }
  return spending;
}

function localAccountIsActive(userId, link) {
  const table = { credit_card: creditCards, bank: bankAccounts, trading: tradingAccounts }[link.localAccountType];
  if (!table) return false;
  const account = db.select().from(table).where(and(eq(table.id, link.localAccountId), eq(table.userId, userId))).get();
  return Boolean(account?.isActive);
}

function categoryForImportedExpense(userId, transaction, { trackRuleMatch = true } = {}) {
  let owned = db.select().from(categories).where(eq(categories.userId, userId)).all();
  let raw = {};
  try {
    const plaintext = decryptCustomerValue(sqlite, userId, 'simplefin-transaction:raw', transaction.rawData);
    raw = plaintext ? JSON.parse(plaintext) : {};
  } catch { /* A malformed provider extra must never block transaction import. */ }
  const providerNames = extractProviderCategories(raw?.extra)
    .map(normalizedCategoryName)
    .filter(name => name && !isUncategorized(name));
  const rules = db.select().from(categoryRules).where(eq(categoryRules.userId, userId)).all();
  const rule = rules.find(candidate => ruleMatchesPurchase(candidate, transaction.description, transactionActivityAt(transaction)));
  if (rule) {
    let savedIds = [];
    try { savedIds = JSON.parse(rule.categoryIds || '[]'); } catch { /* Legacy rule. */ }
    const wanted = new Set([rule.categoryId, ...(Array.isArray(savedIds) ? savedIds : [])].map(Number));
    const selected = owned.filter(category => wanted.has(category.id));
    const category = selected.find(item => item.id === rule.categoryId);
    if (category) {
      if (trackRuleMatch) {
        db.update(categoryRules).set({
          matchCount: Number(rule.matchCount || 0) + 1,
          lastMatchedAt: new Date().toISOString(),
        }).where(eq(categoryRules.id, rule.id)).run();
      }
      return { primary: category, categories: [category, ...selected.filter(item => item.id !== category.id)], source: 'customer_rule', providerNames };
    }
  }
  for (const name of providerNames) {
    if (owned.some(category => category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) continue;
    try {
      db.insert(categories).values({ userId, name, color: PROVIDER_CATEGORY_COLORS[owned.length % PROVIDER_CATEGORY_COLORS.length] }).run();
    } catch (error) {
      if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
    }
    owned = db.select().from(categories).where(eq(categories.userId, userId)).all();
  }
  const providerCategories = providerNames
    .map(name => owned.find(category => category.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
    .filter(Boolean);
  if (providerCategories.length) {
    return { primary: providerCategories[0], categories: providerCategories, source: 'provider', providerNames };
  }
  let uncategorized = owned.find(category => category.name.toLocaleLowerCase() === 'uncategorized');
  if (!uncategorized) {
    try {
      db.insert(categories).values({ userId, name: 'Uncategorized', color: '#6c757d' }).run();
    } catch (error) {
      if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
    }
    uncategorized = db.select().from(categories).where(eq(categories.userId, userId)).all()
      .find(category => category.name.toLocaleLowerCase() === 'uncategorized');
  }
  const primary = uncategorized || { name: 'Uncategorized' };
  return { primary, categories: [primary], source: 'uncategorized', providerNames };
}

function refreshedImportedCategories(metadata, assignment) {
  const travelNames = [...new Set(Object.values(metadata.travelTags || {}).map(String))];
  const currentBase = (Array.isArray(metadata.categories) ? metadata.categories : [])
    .filter(name => !travelNames.includes(name) && !isUncategorized(name));
  const priorProvider = (Array.isArray(metadata.providerCategories) ? metadata.providerCategories : [])
    .map(name => String(name).toLocaleLowerCase());
  const currentBaseNormalized = currentBase.map(name => String(name).toLocaleLowerCase());
  const stillProviderManaged = metadata.categorySource === 'uncategorized'
    || (metadata.categorySource === 'provider'
      && currentBaseNormalized.length === priorProvider.length
      && currentBaseNormalized.every(name => priorProvider.includes(name)));

  let baseNames;
  let source;
  if (assignment.source === 'customer_rule') {
    baseNames = assignment.categories.map(category => category.name);
    source = 'customer_rule';
  } else if (currentBase.length && !stillProviderManaged) {
    baseNames = currentBase;
    source = 'customer';
  } else if (assignment.source === 'provider') {
    baseNames = assignment.categories.map(category => category.name);
    source = 'provider';
  } else {
    baseNames = currentBase;
    source = currentBase.length ? metadata.categorySource : 'uncategorized';
  }

  const combined = [...new Set([...baseNames, ...travelNames])];
  const normalized = normalizeExpenseCategories({
    ...metadata,
    categories: combined,
    mainCategory: baseNames[0] || travelNames[0] || '',
  });
  return {
    ...normalized,
    categorySource: source,
    providerCategories: assignment.providerNames,
  };
}

function refreshedImportedDescription(currentDescription, metadata, providerDescription) {
  const current = String(currentDescription || '').trim();
  const priorProvider = String(metadata?.providerDescription || '').trim();
  const nextProvider = String(providerDescription || '').trim();
  if (!nextProvider) return current || 'Transaction';
  // Advance provider-managed descriptions (notably pending -> posted), but do
  // not overwrite a merchant name the customer has edited themselves.
  const stalePendingDescription = metadata?.providerPending === false
    && /(^|[^a-z])pending([^a-z]|$)/i.test(current)
    && current !== nextProvider;
  if (!current || !priorProvider || current === priorProvider || stalePendingDescription) return nextProvider;
  return current;
}

function isMaterializableTransaction(transaction) {
  if (['expense', 'refund'].includes(transaction?.classification)) return true;
  return Boolean(transaction?.pending) && Number(transaction?.amount) < 0;
}

function createImportedExpense(userId, link, transaction) {
  const amount = Number(transaction.amount);
  if (!Number.isFinite(amount) || !isMaterializableTransaction(transaction)) return null;
  const activityAt = transactionActivityAt(transaction);
  const remoteAccount = db.select().from(simplefinAccounts).where(eq(simplefinAccounts.id, transaction.simplefinAccountId)).get();
  const nativeCurrency = remoteAccount?.currency || 'USD';
  const profile = db.select().from(financialProfiles).where(eq(financialProfiles.userId, userId)).get();
  const reportingCurrency = profile?.reportingCurrency || 'USD';
  const fx = ratesForDate(activityAt.slice(0, 10));
  const convertedAmount = nativeCurrency === reportingCurrency
    ? amount : convertCurrency(amount, nativeCurrency, reportingCurrency, fx.rates);
  if (!Number.isFinite(convertedAmount)) return null;
  const spending = ensureMonthlySpending(userId, link, transaction);
  const assignment = categoryForImportedExpense(userId, transaction);
  const assignedCategory = assignment.primary;
  const expense = protectExpenseRecord(sqlite, userId, {
    id: crypto.randomUUID(),
    spendingId: spending.id,
    description: transaction.description,
    amount: transaction.classification === 'refund' ? -Math.abs(convertedAmount) : Math.abs(convertedAmount),
    category: assignedCategory.name,
    date: activityAt.slice(0, 10),
    data: JSON.stringify({
      source: 'simplefin',
      simplefinTransactionId: transaction.id,
      providerDescription: transaction.description,
      providerAmount: transaction.amount,
      providerPostedAt: transaction.pending ? null : transaction.postedAt,
      providerTransactedAt: transaction.transactedAt || transaction.postedAt,
      providerPending: Boolean(transaction.pending),
      localAccountType: link.localAccountType,
      providerClassification: transaction.classification,
      providerCurrency: nativeCurrency,
      reportingCurrency,
      fxRateDate: nativeCurrency === reportingCurrency ? null : fx.date,
      importedAt: new Date().toISOString(),
      categories: assignment.categories.map(category => category.name),
      mainCategory: assignedCategory.name,
      categorySource: assignment.source,
      providerCategories: assignment.providerNames,
    }),
  });
  db.insert(expenses).values(expense).run();
  db.update(simplefinTransactions).set({ expenseId: expense.id })
    .where(eq(simplefinTransactions.id, transaction.id)).run();
  return expense;
}

function refreshImportedExpense(transaction) {
  if (!transaction.expenseId) return false;
  const stored = db.select().from(expenses).where(eq(expenses.id, transaction.expenseId)).get();
  if (!stored) return false;
  const expense = revealExpenseRecord(sqlite, stored);
  const data = expenseData(stored);
  if (data.source !== 'simplefin') return false; // Confirmed manual duplicate.
  const amount = Number(transaction.amount);
  if (!Number.isFinite(amount) || !isMaterializableTransaction(transaction)) return false;
  const activityAt = transactionActivityAt(transaction);
  const userId = expenseOwnerIdForRefresh(expense);
  const assignment = categoryForImportedExpense(userId, transaction, { trackRuleMatch: false });
  const categoryUpdate = refreshedImportedCategories(data, assignment);
  const reportingCurrency = data.reportingCurrency || 'USD';
  const nativeCurrency = data.providerCurrency || 'USD';
  const fx = ratesForDate(activityAt.slice(0, 10));
  const convertedAmount = nativeCurrency === reportingCurrency
    ? amount : convertCurrency(amount, nativeCurrency, reportingCurrency, fx.rates);
  if (!Number.isFinite(convertedAmount)) return false;
  db.update(expenses).set(protectExpenseRecord(sqlite, userId, {
    description: refreshedImportedDescription(expense.description, data, transaction.description),
    amount: transaction.classification === 'refund' ? -Math.abs(convertedAmount) : Math.abs(convertedAmount),
    date: activityAt.slice(0, 10),
    category: categoryUpdate.mainCategory,
    data: JSON.stringify({
      ...data,
      ...categoryUpdate,
      providerDescription: transaction.description,
      providerAmount: transaction.amount,
      providerPostedAt: transaction.pending ? null : transaction.postedAt,
      providerTransactedAt: transaction.transactedAt || data.providerTransactedAt || transaction.postedAt,
      providerPending: Boolean(transaction.pending),
      providerClassification: transaction.classification,
      fxRateDate: nativeCurrency === reportingCurrency ? null : fx.date,
    }),
  })).where(eq(expenses.id, expense.id)).run();
  return true;
}

function expenseOwnerIdForRefresh(expense) {
  return sqlite.prepare('SELECT user_id FROM monthly_spending WHERE id = ?').get(expense.spendingId)?.user_id;
}

function materializeConnection(connectionId, userId) {
  const accounts = db.select().from(simplefinAccounts).where(eq(simplefinAccounts.connectionId, connectionId)).all();
  const accountIds = new Set(accounts.map((account) => account.id));
  const links = db.select().from(financialAccountLinks).where(and(
    eq(financialAccountLinks.userId, userId),
    eq(financialAccountLinks.status, 'linked'),
    eq(financialAccountLinks.transactionSyncEnabled, true)
  )).all().filter((link) => accountIds.has(link.simplefinAccountId) && link.localAccountType !== 'trading');
  const allLinks = db.select().from(financialAccountLinks).where(and(
    eq(financialAccountLinks.userId, userId),
    eq(financialAccountLinks.status, 'linked')
  )).all();
  const accountTypes = new Map(allLinks.map(link => [link.simplefinAccountId, link.localAccountType]));
  const allTransactions = allLinks.flatMap(link => db.select().from(simplefinTransactions)
    .where(eq(simplefinTransactions.simplefinAccountId, link.simplefinAccountId)).all());
  let expensesMaterialized = 0;
  let duplicateCandidates = 0;

  sqlite.transaction(() => {
    for (const link of links) {
      const transactions = db.select().from(simplefinTransactions)
        .where(eq(simplefinTransactions.simplefinAccountId, link.simplefinAccountId)).all();
      for (const transaction of transactions) {
        let effective = transaction;
        if (transaction.classificationSource !== 'user') {
          const decision = classifyTransaction(transaction, link.localAccountType, allTransactions, accountTypes);
          db.update(simplefinTransactions).set({
            classification: decision.classification,
            classificationSource: 'automatic',
            classificationReason: decision.reason,
          }).where(eq(simplefinTransactions.id, transaction.id)).run();
          effective = { ...transaction, ...decision, classificationSource: 'automatic' };
        }
        if (effective.expenseId) {
          if (isMaterializableTransaction(effective)) {
            refreshImportedExpense(effective);
          } else {
            const existingExpense = db.select().from(expenses).where(eq(expenses.id, effective.expenseId)).get();
            if (expenseData(existingExpense).source === 'simplefin') {
              db.delete(expenses).where(eq(expenses.id, existingExpense.id)).run();
              db.update(simplefinTransactions).set({ expenseId: null })
                .where(eq(simplefinTransactions.id, effective.id)).run();
            }
          }
          continue;
        }
        if (!localAccountIsActive(userId, link)) continue;
        if (!isMaterializableTransaction(effective)) continue;
        if (link.transactionImportFrom && transactionActivityAt(effective).slice(0, 10) < link.transactionImportFrom) continue;
        if (effective.classification === 'refund') {
          if (createImportedExpense(userId, link, effective)) expensesMaterialized += 1;
          continue;
        }
        const existingCandidate = db.select().from(simplefinDuplicateCandidates)
          .where(eq(simplefinDuplicateCandidates.simplefinTransactionId, transaction.id)).get();
        if (existingCandidate) continue;

        const probable = findProbableDuplicate(userId, link, effective);
        if (probable) {
          db.insert(simplefinDuplicateCandidates).values({
            id: crypto.randomUUID(),
            userId,
            simplefinTransactionId: effective.id,
            possibleExpenseId: probable.expense.id,
            status: 'pending',
            score: probable.score,
            createdAt: new Date().toISOString(),
          }).run();
          duplicateCandidates += 1;
        } else if (createImportedExpense(userId, link, effective)) {
          expensesMaterialized += 1;
        }
      }
    }
  })();
  return { expensesMaterialized, duplicateCandidates };
}

function resolveDuplicate(candidateId, userId, action) {
  if (!['keep_manual', 'import_separately'].includes(action)) throw new Error('Choose a valid duplicate action');
  let result;
  sqlite.transaction(() => {
    const candidate = db.select().from(simplefinDuplicateCandidates).where(and(
      eq(simplefinDuplicateCandidates.id, candidateId),
      eq(simplefinDuplicateCandidates.userId, userId),
      eq(simplefinDuplicateCandidates.status, 'pending')
    )).get();
    if (!candidate) throw new Error('Duplicate candidate not found');
    const transaction = db.select().from(simplefinTransactions)
      .where(eq(simplefinTransactions.id, candidate.simplefinTransactionId)).get();
    const link = transaction ? db.select().from(financialAccountLinks).where(and(
      eq(financialAccountLinks.userId, userId),
      eq(financialAccountLinks.simplefinAccountId, transaction.simplefinAccountId),
      eq(financialAccountLinks.status, 'linked')
    )).get() : null;
    if (!transaction || !link) throw new Error('The linked transaction is no longer available');

    let expenseId = candidate.possibleExpenseId;
    if (action === 'import_separately') {
      expenseId = createImportedExpense(userId, link, transaction)?.id;
      if (!expenseId) throw new Error('This provider transaction cannot be imported as an expense');
    } else {
      const manualExpense = candidate.possibleExpenseId
        ? db.select().from(expenses).where(eq(expenses.id, candidate.possibleExpenseId)).get() : null;
      if (!manualExpense) throw new Error('The possible manual duplicate no longer exists');
      db.update(simplefinTransactions).set({ expenseId: manualExpense.id })
        .where(eq(simplefinTransactions.id, transaction.id)).run();
    }
    db.update(simplefinDuplicateCandidates).set({ status: action, resolvedAt: new Date().toISOString() })
      .where(eq(simplefinDuplicateCandidates.id, candidate.id)).run();
    result = { action, expenseId };
  })();
  return result;
}

module.exports = {
  normalizeDescription,
  descriptionSimilarity,
  decimalToCents,
  isMaterializableTransaction,
  refreshedImportedCategories,
  refreshedImportedDescription,
  materializeConnection,
  resolveDuplicate,
};
