const { Router } = require('express');
const { eq, and } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const { monthlySpending, expenses, creditCards, splitPeople, simplefinAccounts, simplefinTransactions, categories, categoryRules } = require('../db/schema');
const { runSubscriptionDetection } = require('../lib/subscriptionDetection');
const { cleanId, cleanNumber, cleanText, hasOnlyKeys, isIsoDate } = require('../middleware/inputValidation');
const { protectExpenseRecord, revealExpenseData, revealExpenseRecord } = require('../lib/customerDataFields');
const { customerPaidAmount } = require('../lib/expenseAmounts');
const { resolveExpenseIcon } = require('../lib/iconResolver');
const { normalizeExpenseCategories } = require('../lib/expenseCategories');
const { applyTravelPlansToExpense, recordTravelTagSuppressions, reapplyTravelPlans } = require('../lib/travelPlans');
const { replaceExpenseCategories, ruleMatchesPurchase } = require('../lib/categoryRuleApplication');
const { decryptCustomerValue } = require('../lib/customerEncryption');
const { FEATURES, enabledFeatures, hasFeature } = require('../lib/featureFlags');

const router = Router();

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function categoryRuleAssignment(userId, description, date, metadata) {
  const rule = db.select().from(categoryRules).where(eq(categoryRules.userId, userId)).all()
    .find(candidate => ruleMatchesPurchase(candidate, description, date));
  if (!rule) return null;

  let savedIds = [];
  try { savedIds = JSON.parse(rule.categoryIds || '[]'); } catch { /* Legacy rules use categoryId. */ }
  const wanted = new Set([rule.categoryId, ...(Array.isArray(savedIds) ? savedIds : [])].map(Number));
  const owned = db.select().from(categories).where(eq(categories.userId, userId)).all();
  const selected = owned.filter(category => wanted.has(category.id));
  const primary = selected.find(category => category.id === rule.categoryId);
  if (!primary) return null;

  const ordered = [primary, ...selected.filter(category => category.id !== primary.id)];
  db.update(categoryRules).set({
    matchCount: Number(rule.matchCount || 0) + 1,
    lastMatchedAt: new Date().toISOString(),
  }).where(eq(categoryRules.id, rule.id)).run();
  return { primary, metadata: replaceExpenseCategories(metadata, ordered.map(category => category.name)).metadata };
}

// GET /api/spending?year=&month=
router.get('/', (req, res) => {
  const { year, month } = req.query;
  const userId = req.user.accountId;

  // Bulk mode: no year/month = return all spending for the user
  if (!year || !month) {
    console.log('[spending] bulk fetch for userId:', userId);
    const records = db.select().from(monthlySpending)
      .where(eq(monthlySpending.userId, userId)).all();
    console.log('[spending] records found:', records.length);
    const result = records.map(record => {
      const exps = db.select().from(expenses)
        .where(eq(expenses.spendingId, record.id)).all()
        .filter(expense => !expense.hiddenAt)
        .map(deserializeExpense);
      return { ...record, expenses: exps };
    });
    return res.json(result);
  }
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2100 || !Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
    return res.status(400).json({ error: 'Year and month are invalid.' });
  }
  const records = db.select().from(monthlySpending).where(
    and(
      eq(monthlySpending.userId, userId),
      eq(monthlySpending.year, parsedYear),
      eq(monthlySpending.month, parsedMonth)
    )
  ).all();

  // Attach expenses to each record
  const result = records.map(record => {
    const exps = db.select().from(expenses)
      .where(eq(expenses.spendingId, record.id))
      .all()
      .filter(expense => !expense.hiddenAt)
      .map(deserializeExpense);
    return { ...record, expenses: exps };
  });

  res.json(result);
});

router.get('/beta-features', (req, res) => {
  res.json({ features: enabledFeatures(req.user.accountId) });
});

router.get('/expense/:id/diagnostics', (req, res) => {
  const userId = req.user.accountId;
  if (!hasFeature(userId, FEATURES.PURCHASE_DATA_INSPECTOR)) {
    return res.status(404).json({ error: 'Purchase diagnostics are not enabled for this account.' });
  }
  const validatedId = cleanId(req.params.id, 'Expense identifier');
  if (validatedId.error) return res.status(400).json({ error: validatedId.error });
  const stored = db.select().from(expenses).where(eq(expenses.id, validatedId.value)).get();
  const parent = stored ? db.select().from(monthlySpending).where(and(
    eq(monthlySpending.id, stored.spendingId),
    eq(monthlySpending.userId, userId)
  )).get() : null;
  if (!stored || !parent || stored.hiddenAt) return res.status(404).json({ error: 'Purchase not found.' });

  const expense = revealExpenseRecord(sqlite, stored);
  const metadata = parseJson(expense.data);
  const transaction = db.select().from(simplefinTransactions)
    .where(eq(simplefinTransactions.expenseId, expense.id)).get();
  let providerPayload = null;
  let providerAccount = null;
  if (transaction) {
    try {
      providerPayload = parseJson(decryptCustomerValue(
        sqlite, userId, 'simplefin-transaction:raw', transaction.rawData
      ), null);
    } catch { providerPayload = { unavailable: 'The stored provider payload could not be decrypted.' }; }
    const remoteAccount = db.select().from(simplefinAccounts)
      .where(eq(simplefinAccounts.id, transaction.simplefinAccountId)).get();
    if (remoteAccount) providerAccount = {
      name: remoteAccount.remoteName,
      institution: remoteAccount.institutionName,
      currency: remoteAccount.currency,
      remoteAccountId: remoteAccount.remoteAccountId,
    };
  }

  return res.json({
    purchase: {
      id: expense.id,
      description: expense.description,
      amount: expense.amount,
      date: expense.date,
      category: expense.category,
      tags: normalizeExpenseCategories(metadata).categories,
      metadata,
    },
    simplefin: transaction ? {
      transaction: {
        remoteTransactionId: transaction.remoteTransactionId,
        description: transaction.description,
        amount: transaction.amount,
        pending: Boolean(transaction.pending),
        postedAt: transaction.postedAt,
        transactedAt: transaction.transactedAt,
        firstSeenAt: transaction.firstSeenAt,
        lastSeenAt: transaction.lastSeenAt,
        classification: transaction.classification,
        classificationSource: transaction.classificationSource,
        classificationReason: transaction.classificationReason,
      },
      account: providerAccount,
      providerPayload,
    } : null,
  });
});

// POST /api/spending/expense
router.post('/expense', (req, res) => {
  const { year, month, cardId, expenseData, updateId } = req.body;
  const userId = req.user.accountId;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Year and month are invalid.' });
  }
  const validatedCardId = cleanId(cardId, 'Card identifier');
  const validatedUpdateId = updateId ? cleanId(updateId, 'Expense identifier') : { value: null };
  if (validatedCardId.error || validatedUpdateId.error) return res.status(400).json({ error: validatedCardId.error || validatedUpdateId.error });
  const ownedCard = db.select().from(creditCards).where(and(eq(creditCards.id, validatedCardId.value), eq(creditCards.userId, userId))).get();
  if (!ownedCard) return res.status(400).json({ error: 'Choose a valid credit card.' });
  const validatedExpense = validateExpenseInput(expenseData, false);
  if (validatedExpense.error) return res.status(400).json({ error: validatedExpense.error });

  // Find or create the monthly_spending record
  let record = db.select().from(monthlySpending).where(
    and(
      eq(monthlySpending.userId, userId),
      eq(monthlySpending.year, year),
      eq(monthlySpending.month, month),
      eq(monthlySpending.cardId, validatedCardId.value)
    )
  ).get();

  if (!record) {
    const id = Date.now().toString();
    db.insert(monthlySpending).values({
      id,
      userId,
      year,
      month,
      cardId: validatedCardId.value,
    }).run();
    record = db.select().from(monthlySpending).where(eq(monthlySpending.id, id)).get();
  }

  const expenseId = validatedUpdateId.value
    ? validatedUpdateId.value
    : Date.now().toString() + Math.random().toString(36).substr(2, 9);

  const { description, amount, category, date, ...rest } = validatedExpense.value;

  const existing = db.select().from(expenses).where(eq(expenses.id, expenseId)).get();
  if (!ownedCard.isActive && !existing) return res.status(409).json({ error: 'Reactivate this account before adding new expenses.' });

  if (existing) {
    const ownerRecord = db.select().from(monthlySpending).where(and(
      eq(monthlySpending.id, existing.spendingId),
      eq(monthlySpending.userId, userId)
    )).get();
    if (!ownerRecord) return res.status(403).json({ error: 'Forbidden' });
    const revealed = revealExpenseRecord(sqlite, existing);
    const existingData = parseExpenseData(existing);
    const imported = existingData.source === 'simplefin';
    if (imported && (
      (amount != null && Number(amount) !== Number(revealed.amount))
      || (date != null && date !== revealed.date)
    )) return res.status(409).json({ error: 'Amount and date are controlled by SimpleFIN for synced expenses.' });
    db.update(expenses).set(protectExpenseRecord(sqlite, userId, {
      description: description ?? revealed.description, amount: imported ? revealed.amount : amount ?? revealed.amount,
      category: category ?? revealed.category, date: imported ? revealed.date : date ?? revealed.date,
      data: JSON.stringify(mergeExpenseMetadata(existingData, userEditableExpenseData(rest))),
    })).where(eq(expenses.id, expenseId)).run();
  } else {
    const initialMetadata = normalizeExpenseCategories(userEditableExpenseData(rest));
    const assignment = categoryRuleAssignment(userId, description, date, initialMetadata);
    db.insert(expenses).values(protectExpenseRecord(sqlite, userId, {
      id: expenseId,
      spendingId: record.id,
      description,
      amount,
      category: assignment?.primary.name || category,
      date,
      data: JSON.stringify(assignment?.metadata || initialMetadata),
    })).run();
  }

  // Run subscription detection in the background
  try { runSubscriptionDetection(userId); } catch (e) { /* non-fatal */ }
  try { reapplyTravelPlans(userId); } catch (e) { /* non-fatal derived tags */ }

  const saved = db.select().from(expenses).where(eq(expenses.id, expenseId)).get();
  res.json(deserializeExpense(saved));
});

// PATCH /api/spending/expense/:id
router.patch('/expense/:id', (req, res) => {
  const { updateData } = req.body;
  const userId = req.user.accountId;
  const validatedExpense = validateExpenseInput(updateData, true);
  if (validatedExpense.error) return res.status(400).json({ error: validatedExpense.error });
  const { description, amount, category, date, ...rest } = validatedExpense.value;
  const affectsSubscriptionDetection = ['description', 'amount', 'date']
    .some(field => Object.hasOwn(validatedExpense.value, field));
  const affectsTravelTags = affectsSubscriptionDetection || ['category', 'categories', 'mainCategory']
    .some(field => Object.hasOwn(validatedExpense.value, field));

  const existing = db.select().from(expenses).where(eq(expenses.id, req.params.id)).get();
  if (!existing) return res.json(null);

  // Verify the expense belongs to this user via its parent monthly_spending record
  const record = db.select().from(monthlySpending)
    .where(and(eq(monthlySpending.id, existing.spendingId), eq(monthlySpending.userId, userId)))
    .get();
  if (!record) return res.status(403).json({ error: 'Forbidden' });

  const revealed = revealExpenseRecord(sqlite, existing);
  const existingData = parseExpenseData(existing);
  const imported = existingData.source === 'simplefin';
  if (imported && (
    (amount != null && Number(amount) !== Number(revealed.amount))
    || (date != null && date !== revealed.date)
  )) return res.status(409).json({ error: 'Amount and date are controlled by SimpleFIN for synced expenses.' });
  db.update(expenses).set(protectExpenseRecord(sqlite, userId, {
    description: description ?? revealed.description, amount: imported ? revealed.amount : amount ?? revealed.amount,
    category: category ?? revealed.category, date: imported ? revealed.date : date ?? revealed.date,
    data: JSON.stringify(mergeExpenseMetadata(existingData, userEditableExpenseData(rest))),
  })).where(eq(expenses.id, req.params.id)).run();

  if (affectsSubscriptionDetection) {
    try { runSubscriptionDetection(userId); } catch (e) { /* non-fatal */ }
    try { reapplyTravelPlans(userId); } catch (e) { /* non-fatal derived tags */ }
  } else if (affectsTravelTags) {
    const edited = db.select().from(expenses).where(eq(expenses.id, req.params.id)).get();
    try { applyTravelPlansToExpense(userId, edited); } catch (e) { /* non-fatal derived tags */ }
  }

  const updated = db.select().from(expenses).where(eq(expenses.id, req.params.id)).get();
  res.json(deserializeExpense(updated));
});

router.put('/expense/:id/split', (req, res) => {
  const userId = req.user.accountId;
  if (!hasOnlyKeys(req.body, ['mode', 'allocations'])) return res.status(400).json({ error: 'Unsupported split field.' });
  const mode = req.body?.mode;
  const allocations = req.body?.allocations;
  if (!['percent', 'amount'].includes(mode) || !Array.isArray(allocations) || allocations.length > 100) {
    return res.status(400).json({ error: 'Choose percent or amount and at most 100 people.' });
  }
  const stored = db.select().from(expenses).where(eq(expenses.id, req.params.id)).get();
  const parent = stored ? db.select().from(monthlySpending).where(and(eq(monthlySpending.id, stored.spendingId), eq(monthlySpending.userId, userId))).get() : null;
  if (!stored || !parent || stored.hiddenAt) return res.status(404).json({ error: 'Expense not found.' });
  const expense = revealExpenseRecord(sqlite, stored);
  const ownedPeople = new Set(db.select().from(splitPeople).where(eq(splitPeople.userId, userId)).all().map(person => person.id));
  const seen = new Set();
  const cleaned = [];
  for (const allocation of allocations) {
    if (!allocation || typeof allocation !== 'object' || !hasOnlyKeys(allocation, ['personId', 'value']) || !ownedPeople.has(allocation.personId) || seen.has(allocation.personId)) {
      return res.status(400).json({ error: 'Every split must select a unique person from your settings.' });
    }
    const parsed = cleanNumber(allocation.value, { label: 'Split value', min: 0.01, max: mode === 'percent' ? 100 : Math.abs(Number(expense.amount)), required: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    seen.add(allocation.personId);
    cleaned.push({ personId: allocation.personId, value: Math.round(parsed.value * 100) / 100 });
  }
  const total = cleaned.reduce((sum, allocation) => sum + allocation.value, 0);
  const maximum = mode === 'percent' ? 100 : Math.abs(Number(expense.amount));
  if (total > maximum + 0.005) return res.status(400).json({ error: mode === 'percent' ? 'Assigned percentages cannot exceed 100%.' : 'Assigned amounts cannot exceed the purchase amount.' });
  const metadata = parseExpenseData(stored);
  const split = cleaned.length ? { mode, allocations: cleaned } : null;
  db.update(expenses).set(protectExpenseRecord(sqlite, userId, {
    description: expense.description, amount: expense.amount, category: expense.category, date: expense.date,
    data: JSON.stringify({ ...metadata, split }),
  })).where(eq(expenses.id, expense.id)).run();
  res.json(deserializeExpense(db.select().from(expenses).where(eq(expenses.id, expense.id)).get()));
});

// DELETE /api/spending/expense/:id
router.delete('/expense/:id', (req, res) => {
  const userId = req.user.accountId;

  const existing = db.select().from(expenses).where(eq(expenses.id, req.params.id)).get();
  if (!existing) return res.json(true); // already gone, idempotent
  if (parseExpenseData(existing).source === 'simplefin') {
    db.update(expenses).set({ hiddenAt: new Date().toISOString() }).where(eq(expenses.id, req.params.id)).run();
    return res.json({ hidden: true });
  }

  // Verify ownership via parent monthly_spending record
  const record = db.select().from(monthlySpending)
    .where(and(eq(monthlySpending.id, existing.spendingId), eq(monthlySpending.userId, userId)))
    .get();
  if (!record) return res.status(403).json({ error: 'Forbidden' });

  db.delete(expenses).where(eq(expenses.id, req.params.id)).run();
  res.json(true);
});

function deserializeExpense(row) {
  if (!row) return null;
  const revealed = revealExpenseRecord(sqlite, row);
  const { data, encryptedPayload, ...rest } = revealed;
  const plaintext = revealed.data;
  const metadata = normalizeExpenseCategories(plaintext ? JSON.parse(plaintext) : {});
  const paidAmount = customerPaidAmount(revealed.amount, metadata.split);
  const linkedSimplefinTransaction = db.select({
    id: simplefinTransactions.id,
    pending: simplefinTransactions.pending,
    postedAt: simplefinTransactions.postedAt,
    transactedAt: simplefinTransactions.transactedAt,
  })
    .from(simplefinTransactions).where(eq(simplefinTransactions.expenseId, revealed.id)).get();
  const transactionTime = linkedSimplefinTransaction
    ? linkedSimplefinTransaction.transactedAt || linkedSimplefinTransaction.postedAt
    : metadata.providerTransactedAt || metadata.providerPostedAt || null;
  const transactionTimePrecision = linkedSimplefinTransaction?.transactedAt ? 'time' : transactionTime ? 'date' : null;
  return {
    ...rest,
    ...metadata,
    originalAmount: revealed.amount,
    amount: paidAmount,
    simplefinLinked: Boolean(linkedSimplefinTransaction),
    transactionTime,
    transactionTimePrecision,
    pending: linkedSimplefinTransaction ? Boolean(linkedSimplefinTransaction.pending) : Boolean(metadata.providerPending),
    icon: resolveExpenseIcon(revealed, metadata),
  };
}

function parseExpenseData(row) {
  try {
    const plaintext = revealExpenseData(sqlite, row);
    return plaintext ? JSON.parse(plaintext) : {};
  } catch { return {}; }
}

function userEditableExpenseData(data) {
  const editable = { ...(data || {}) };
  for (const key of [
    'source',
    'simplefinTransactionId',
    'providerDescription',
    'providerAmount',
    'providerPostedAt',
    'providerClassification',
    'providerCurrency',
    'reportingCurrency',
    'fxRateDate',
    'localAccountType',
    'importedAt',
  ]) delete editable[key];
  return editable;
}

function mergeExpenseMetadata(existing, updates) {
  const merged = { ...(existing || {}), ...(updates || {}) };
  if (Object.hasOwn(updates || {}, 'categories') || Object.hasOwn(updates || {}, 'mainCategory')) merged.categorySource = 'customer';
  if (Object.hasOwn(updates || {}, 'categories')) {
    merged.travelTagSuppressions = recordTravelTagSuppressions(existing, updates.categories);
    merged.categories = updates.categories;
    if (!merged.categories.includes(merged.mainCategory)) merged.mainCategory = merged.categories[0] || '';
  } else if (updates?.mainCategory) {
    const categories = Array.isArray(existing?.categories) ? existing.categories : [];
    merged.categories = [updates.mainCategory, ...categories.filter(category => category !== updates.mainCategory)];
  }
  return normalizeExpenseCategories(merged);
}

function validateExpenseInput(value, partial) {
  const allowed = ['description', 'amount', 'category', 'date', 'categories', 'mainCategory', 'notes', 'tags', 'excludedFromReporting'];
  if (!hasOnlyKeys(value, allowed)) return { error: 'Unsupported expense field.' };
  const output = {};
  if (!partial || Object.hasOwn(value, 'description')) {
    const result = cleanText(value.description, { label: 'Description', max: 500, required: !partial });
    if (result.error) return result;
    if (result.value != null) output.description = result.value;
  }
  if (!partial || Object.hasOwn(value, 'amount')) {
    const result = cleanNumber(value.amount, { label: 'Amount', min: -1e12, max: 1e12, required: !partial });
    if (result.error) return result;
    if (result.value != null) output.amount = result.value;
  }
  if (Object.hasOwn(value, 'date')) {
    if (!isIsoDate(value.date)) return { error: 'Expense date must be a valid YYYY-MM-DD date.' };
    output.date = value.date;
  } else if (!partial) return { error: 'Expense date is required.' };
  for (const field of ['category', 'mainCategory']) {
    if (!Object.hasOwn(value, field)) continue;
    const result = cleanText(value[field], { label: field, max: 80 });
    if (result.error) return result;
    output[field] = result.value || '';
  }
  for (const field of ['categories', 'tags']) {
    if (!Object.hasOwn(value, field)) continue;
    if (!Array.isArray(value[field]) || value[field].length > 20) return { error: `${field} must contain at most 20 items.` };
    const max = field === 'categories' ? 80 : 50;
    const cleaned = [];
    for (const item of value[field]) {
      const result = cleanText(item, { label: field, max, required: true });
      if (result.error) return result;
      if (!cleaned.includes(result.value)) cleaned.push(result.value);
    }
    output[field] = cleaned;
  }
  if (Object.hasOwn(value, 'notes')) {
    const result = cleanText(value.notes, { label: 'Notes', max: 2000 });
    if (result.error) return result;
    output.notes = result.value || '';
  }
  if (Object.hasOwn(value, 'excludedFromReporting')) {
    if (typeof value.excludedFromReporting !== 'boolean') return { error: 'excludedFromReporting must be true or false.' };
    output.excludedFromReporting = value.excludedFromReporting;
  }
  return { value: output };
}

module.exports = router;
