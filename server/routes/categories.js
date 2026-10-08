const { Router } = require('express');
const crypto = require('crypto');
const { eq, and } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const { categories, categoryRules, expenses, monthlySpending, simplefinTransactions } = require('../db/schema');
const { normalizedCategoryName } = require('../lib/categoryValidation');
const { normalizeMerchant, suggestedMerchant } = require('../lib/merchantRules');
const { hasOnlyKeys, isIsoDate } = require('../middleware/inputValidation');
const { protectExpenseRecord, revealExpenseData, revealExpenseRecord } = require('../lib/customerDataFields');
const { isUncategorized, normalizeExpenseCategories } = require('../lib/expenseCategories');
const { replaceExpenseCategories, ruleMatchesPurchase } = require('../lib/categoryRuleApplication');
const { reapplyTravelPlans, ownedTravelPlans, travelPreferenceCategoryIds, saveTravelPreferenceCategoryIds } = require('../lib/travelPlans');
const { DEFAULT_COLORS, defaultByName, ensureDefaultsForAccount } = require('../lib/defaultCategories');

const router = Router();
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function publicCategory(category) {
  return { id: category.id, name: category.name, color: category.color, isDefault: Boolean(defaultByName(category.name)) };
}

function ownedCategories(userId) {
  return db.select().from(categories).where(eq(categories.userId, userId)).all();
}

function findOwnedByName(userId, value) {
  const normalized = String(value || '').trim().toLocaleLowerCase();
  return ownedCategories(userId).find(category => category.name.toLocaleLowerCase() === normalized) || null;
}

function categoriesForRule(userId, rule) {
  const owned = ownedCategories(userId);
  let ids = [];
  try { ids = JSON.parse(rule.categoryIds || '[]'); } catch { /* Legacy rules use categoryId below. */ }
  const wanted = new Set([rule.categoryId, ...(Array.isArray(ids) ? ids : [])].map(Number));
  const selected = owned.filter(category => wanted.has(category.id) && !isUncategorized(category.name));
  const primary = selected.find(category => category.id === rule.categoryId);
  return primary ? [primary, ...selected.filter(category => category.id !== primary.id)] : selected;
}

function categorySnapshot(userId, metadata, primaryCategory) {
  const names = [primaryCategory.name, ...(Array.isArray(metadata.categories) ? metadata.categories : [])];
  const wanted = new Set(names.map(name => String(name || '').trim().toLocaleLowerCase()).filter(Boolean));
  const selected = ownedCategories(userId).filter(category => wanted.has(category.name.toLocaleLowerCase()) && !isUncategorized(category.name));
  return [primaryCategory, ...selected.filter(category => category.id !== primaryCategory.id)];
}

function expenseMetadata(expense) {
  try { return JSON.parse(revealExpenseData(sqlite, expense) || '{}'); } catch { return {}; }
}

function publicRule(rule, ruleCategories) {
  const [category, ...additionalCategories] = ruleCategories;
  if (!category) return null;
  return {
    id: rule.id,
    merchant: rule.merchantLabel || rule.normalizedMerchant,
    effectiveFrom: rule.effectiveFrom || '1970-01-01',
    category: publicCategory(category),
    categories: [category, ...additionalCategories].map(publicCategory),
    matchCount: rule.matchCount,
    createdAt: rule.createdAt,
    lastMatchedAt: rule.lastMatchedAt,
  };
}

function ownedRuleSourceExpense(userId, expenseId) {
  const expense = db.select().from(expenses).where(eq(expenses.id, String(expenseId || ''))).get();
  if (expense?.hiddenAt) return null;
  const spending = expense ? db.select().from(monthlySpending).where(and(
    eq(monthlySpending.id, expense.spendingId), eq(monthlySpending.userId, userId)
  )).get() : null;
  const metadata = expenseMetadata(expense);
  const linkedTransaction = expense ? db.select().from(simplefinTransactions)
    .where(eq(simplefinTransactions.expenseId, expense.id)).get() : null;
  if (!expense || !spending) return null;
  return {
    expense: revealExpenseRecord(sqlite, expense),
    metadata: {
      ...metadata,
      providerDescription: metadata.providerDescription || linkedTransaction?.description,
      simplefinTransactionId: metadata.simplefinTransactionId || linkedTransaction?.id,
    },
  };
}

function validatedRuleInput(body) {
  const merchant = typeof body?.merchant === 'string' ? body.merchant.trim() : '';
  const effectiveFrom = body?.effectiveFrom;
  if (!merchant || merchant.length > 80 || !normalizeMerchant(merchant)) return { error: 'Merchant pattern must be between 1 and 80 characters.' };
  if (!isIsoDate(effectiveFrom)) return { error: 'Choose a valid apply-from date.' };
  return { merchant, normalizedMerchant: normalizeMerchant(merchant), effectiveFrom };
}

function applyRuleToHistory(userId, rule, ruleCategories) {
  const [category] = ruleCategories;
  let appliedCount = 0;
  const spendingIds = new Set(db.select().from(monthlySpending).where(eq(monthlySpending.userId, userId)).all().map(row => row.id));
  for (const stored of db.select().from(expenses).all()) {
    if (stored.hiddenAt) continue;
    const expense = revealExpenseRecord(sqlite, stored);
    if (!spendingIds.has(expense.spendingId) || expense.date < rule.effectiveFrom) continue;
    const metadata = expenseMetadata(expense);
    if (!ruleMatchesPurchase(rule, metadata.providerDescription || expense.description, expense.date)) continue;
    const categoriesList = ruleCategories.map(item => item.name);
    const replacement = replaceExpenseCategories(metadata, categoriesList);
    if (!replacement.changed && expense.category === category.name) continue;
    db.update(expenses).set(protectExpenseRecord(sqlite, userId, {
      description: expense.description, amount: expense.amount, category: category.name, date: expense.date,
      data: JSON.stringify(replacement.metadata),
    })).where(eq(expenses.id, expense.id)).run();
    appliedCount += 1;
  }
  return appliedCount;
}

router.get('/', (req, res) => {
  res.json(ensureDefaultsForAccount(req.user.accountId).map(publicCategory));
});

router.post('/', (req, res) => {
  const userId = req.user.accountId;
  ensureDefaultsForAccount(userId);
  const name = normalizedCategoryName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Category name must be between 1 and 80 characters.' });
  if (isUncategorized(name)) return res.status(400).json({ error: 'Uncategorized is assigned automatically when an expense has no categories.' });
  if (!findOwnedByName(userId, name)) {
    const all = ownedCategories(userId);
    try {
      db.insert(categories).values({ userId, name, color: DEFAULT_COLORS[all.length % DEFAULT_COLORS.length] }).run();
    } catch (error) {
      if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
    }
  }
  return res.json(ownedCategories(userId).map(publicCategory));
});

router.get('/rules', (req, res) => {
  const userId = req.user.accountId;
  const rules = db.select().from(categoryRules).where(eq(categoryRules.userId, userId)).all();
  return res.json(rules.map(rule => publicRule(rule, categoriesForRule(userId, rule))).filter(Boolean));
});

router.get('/rules/from-expense/:expenseId/suggestion', (req, res) => {
  const found = ownedRuleSourceExpense(req.user.accountId, req.params.expenseId);
  if (!found) return res.status(404).json({ error: 'Expense not found' });
  const category = found.metadata.mainCategory || found.expense.category;
  return res.json({
    merchant: suggestedMerchant(found.metadata.providerDescription || found.expense.description),
    effectiveFrom: found.expense.date,
    category,
  });
});

router.post('/rules/from-expense', (req, res) => {
  const userId = req.user.accountId;
  if (!hasOnlyKeys(req.body, ['expenseId', 'category', 'merchant', 'effectiveFrom'])) return res.status(400).json({ error: 'Unsupported merchant rule field.' });
  const found = ownedRuleSourceExpense(userId, req.body?.expenseId);
  if (!found) return res.status(404).json({ error: 'Expense not found' });
  const { expense, metadata } = found;
  const category = findOwnedByName(userId, req.body?.category || metadata.mainCategory || expense.category);
  if (!category || category.name.toLocaleLowerCase() === 'uncategorized') {
    return res.status(400).json({ error: 'Choose a category before creating a merchant rule.' });
  }
  const validated = validatedRuleInput(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const { merchant, normalizedMerchant, effectiveFrom } = validated;
  const ruleCategories = categorySnapshot(userId, metadata, category);
  const categoryIds = JSON.stringify(ruleCategories.map(item => item.id));
  const existing = db.select().from(categoryRules).where(eq(categoryRules.userId, userId)).all()
    .find(rule => rule.normalizedMerchant === normalizedMerchant);
  const now = new Date().toISOString();
  if (existing) {
    db.update(categoryRules).set({ categoryId: category.id, categoryIds, sourceExpenseId: expense.id, merchantLabel: merchant, effectiveFrom })
      .where(and(eq(categoryRules.id, existing.id), eq(categoryRules.userId, userId))).run();
  } else {
    db.insert(categoryRules).values({
      id: crypto.randomUUID(), userId, normalizedMerchant, categoryId: category.id,
      categoryIds, merchantLabel: merchant, effectiveFrom, sourceExpenseId: expense.id, matchCount: 0, createdAt: now,
    }).run();
  }
  const saved = db.select().from(categoryRules).where(eq(categoryRules.userId, userId)).all()
    .find(rule => rule.normalizedMerchant === normalizedMerchant);
  const appliedCount = applyRuleToHistory(userId, saved, ruleCategories);
  reapplyTravelPlans(userId);
  return res.status(existing ? 200 : 201).json({ rule: publicRule(saved, ruleCategories), appliedCount });
});

router.patch('/rules/:id', (req, res) => {
  const userId = req.user.accountId;
  if (!hasOnlyKeys(req.body, ['merchant', 'effectiveFrom', 'category'])) return res.status(400).json({ error: 'Unsupported merchant rule field.' });
  const rule = db.select().from(categoryRules).where(and(eq(categoryRules.id, req.params.id), eq(categoryRules.userId, userId))).get();
  if (!rule) return res.status(404).json({ error: 'Category rule not found' });
  const validated = validatedRuleInput(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const category = findOwnedByName(userId, req.body?.category);
  if (!category) return res.status(400).json({ error: 'Choose a valid category.' });
  const existingCategories = categoriesForRule(userId, rule);
  const updatedCategories = [category, ...existingCategories.filter(item => item.id !== rule.categoryId && item.id !== category.id)];
  try {
    db.update(categoryRules).set({
      normalizedMerchant: validated.normalizedMerchant,
      merchantLabel: validated.merchant,
      effectiveFrom: validated.effectiveFrom,
      categoryId: category.id,
      categoryIds: JSON.stringify(updatedCategories.map(item => item.id)),
    }).where(and(eq(categoryRules.id, rule.id), eq(categoryRules.userId, userId))).run();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'A rule for that merchant already exists.' });
    throw error;
  }
  const updated = db.select().from(categoryRules).where(eq(categoryRules.id, rule.id)).get();
  const appliedCount = applyRuleToHistory(userId, updated, updatedCategories);
  reapplyTravelPlans(userId);
  return res.json({ rule: publicRule(updated, updatedCategories), appliedCount });
});

router.delete('/rules/:id', (req, res) => {
  const rule = db.select().from(categoryRules).where(and(
    eq(categoryRules.id, req.params.id),
    eq(categoryRules.userId, req.user.accountId)
  )).get();
  if (!rule) return res.status(404).json({ error: 'Category rule not found' });
  db.delete(categoryRules).where(and(
    eq(categoryRules.id, rule.id),
    eq(categoryRules.userId, req.user.accountId)
  )).run();
  return res.json({ deleted: true });
});

router.patch('/:name', (req, res) => {
  const userId = req.user.accountId;
  const category = findOwnedByName(userId, req.params.name);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  const color = req.body?.color;
  if (typeof color !== 'string' || !COLOR_PATTERN.test(color)) {
    return res.status(400).json({ error: 'Choose a valid six-digit hex color.' });
  }
  db.update(categories).set({ color }).where(and(
    eq(categories.id, category.id),
    eq(categories.userId, userId)
  )).run();
  return res.json(ownedCategories(userId).map(publicCategory));
});

router.delete('/:name', (req, res) => {
  const userId = req.user.accountId;
  const category = findOwnedByName(userId, req.params.name);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  if (defaultByName(category.name)) return res.status(409).json({ error: 'Default categories are managed by an administrator and cannot be removed.' });
  const tripNames = ownedTravelPlans(userId).map(plan => plan.name.toLocaleLowerCase());
  if (category.name.toLocaleLowerCase() === 'travel' || tripNames.includes(category.name.toLocaleLowerCase())) {
    return res.status(409).json({ error: 'Travel and trip categories are managed by your travel plans.' });
  }

  const removedKey = category.name.toLocaleLowerCase();
  sqlite.transaction(() => {
    for (const rule of db.select().from(categoryRules).where(eq(categoryRules.userId, userId)).all()) {
      let ids = [];
      try { ids = JSON.parse(rule.categoryIds || '[]'); } catch { /* Remove malformed additional references below. */ }
      if (rule.categoryId === category.id) {
        db.delete(categoryRules).where(eq(categoryRules.id, rule.id)).run();
      } else if (Array.isArray(ids) && ids.map(Number).includes(category.id)) {
        db.update(categoryRules).set({ categoryIds: JSON.stringify(ids.map(Number).filter(id => id !== category.id)) })
          .where(eq(categoryRules.id, rule.id)).run();
      }
    }

    const excludedIds = travelPreferenceCategoryIds(userId);
    if (excludedIds.includes(category.id)) saveTravelPreferenceCategoryIds(userId, excludedIds.filter(id => id !== category.id));

    const spendingIds = new Set(db.select().from(monthlySpending).where(eq(monthlySpending.userId, userId)).all().map(row => row.id));
    for (const stored of db.select().from(expenses).all()) {
      if (!spendingIds.has(stored.spendingId)) continue;
      const expense = revealExpenseRecord(sqlite, stored);
      const metadata = expenseMetadata(stored);
      const retained = (Array.isArray(metadata.categories) ? metadata.categories : [])
        .filter(name => String(name || '').trim().toLocaleLowerCase() !== removedKey);
      const normalized = normalizeExpenseCategories({
        ...metadata,
        categories: retained,
        mainCategory: String(metadata.mainCategory || expense.category || '').toLocaleLowerCase() === removedKey ? '' : metadata.mainCategory,
      });
      if (retained.length === (Array.isArray(metadata.categories) ? metadata.categories : []).length
        && String(expense.category || '').toLocaleLowerCase() !== removedKey) continue;
      db.update(expenses).set(protectExpenseRecord(sqlite, userId, {
        description: expense.description,
        amount: expense.amount,
        category: normalized.mainCategory,
        date: expense.date,
        data: JSON.stringify(normalized),
      })).where(eq(expenses.id, expense.id)).run();
    }
    db.delete(categories).where(and(eq(categories.id, category.id), eq(categories.userId, userId))).run();
  })();
  reapplyTravelPlans(userId);
  return res.json({ deleted: true, categories: ensureDefaultsForAccount(userId).map(publicCategory) });
});

module.exports = router;
