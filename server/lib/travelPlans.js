const { eq } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const { travelPlans, travelPreferences, monthlySpending, expenses, detectedSubscriptions, categories } = require('../db/schema');
const { encryptCustomerValue, decryptCustomerValue } = require('./customerEncryption');
const { protectExpenseRecord, revealExpenseRecord } = require('./customerDataFields');
const { normalizeExpenseCategories, isUncategorized } = require('./expenseCategories');

const TRAVEL_COLOR = '#8b5cf6';
const TRAVEL_CATEGORY = 'Travel';

function publicTravelPlan(userId, row) {
  return {
    id: row.id,
    name: decryptCustomerValue(sqlite, userId, 'travel-plan:name', row.encryptedName),
    startDate: decryptCustomerValue(sqlite, userId, 'travel-plan:start-date', row.encryptedStartDate),
    endDate: decryptCustomerValue(sqlite, userId, 'travel-plan:end-date', row.encryptedEndDate),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function protectedTravelPlan(userId, values) {
  return {
    encryptedName: encryptCustomerValue(sqlite, userId, 'travel-plan:name', values.name),
    encryptedStartDate: encryptCustomerValue(sqlite, userId, 'travel-plan:start-date', values.startDate),
    encryptedEndDate: encryptCustomerValue(sqlite, userId, 'travel-plan:end-date', values.endDate),
  };
}

function ownedTravelPlans(userId) {
  return db.select().from(travelPlans).where(eq(travelPlans.userId, userId)).all()
    .map(row => publicTravelPlan(userId, row));
}

function travelPreferenceCategoryIds(userId) {
  const row = db.select().from(travelPreferences).where(eq(travelPreferences.userId, userId)).get();
  if (!row) return [];
  try {
    const plaintext = decryptCustomerValue(sqlite, userId, 'travel-preferences:excluded-categories', row.encryptedExcludedCategoryIds);
    const ids = JSON.parse(plaintext || '[]');
    return Array.isArray(ids) ? [...new Set(ids.filter(Number.isInteger))] : [];
  } catch { return []; }
}

function saveTravelPreferenceCategoryIds(userId, categoryIds) {
  const now = new Date().toISOString();
  const encryptedExcludedCategoryIds = encryptCustomerValue(sqlite, userId, 'travel-preferences:excluded-categories', JSON.stringify(categoryIds));
  db.insert(travelPreferences).values({ userId, encryptedExcludedCategoryIds, updatedAt: now })
    .onConflictDoUpdate({ target: travelPreferences.userId, set: { encryptedExcludedCategoryIds, updatedAt: now } }).run();
}

function excludedCategoryNames(userId) {
  const wanted = new Set(travelPreferenceCategoryIds(userId));
  return new Set(db.select().from(categories).where(eq(categories.userId, userId)).all()
    .filter(category => wanted.has(category.id)).map(category => category.name.toLocaleLowerCase()));
}

function subscriptionDescriptions(userId) {
  const values = new Set();
  for (const row of db.select().from(detectedSubscriptions).where(eq(detectedSubscriptions.userId, userId)).all()) {
    values.add(String(row.description || '').trim().toLocaleLowerCase());
    try {
      for (const variant of JSON.parse(row.variants || '[]')) values.add(String(variant || '').trim().toLocaleLowerCase());
    } catch { /* Ignore malformed legacy variants. */ }
  }
  return values;
}

function isRoutineExpense(expense, metadata, subscriptions, excludedCategories = new Set()) {
  const tags = Array.isArray(metadata.categories) ? metadata.categories : [];
  if (tags.some(tag => excludedCategories.has(String(tag).trim().toLocaleLowerCase()))) return true;
  return subscriptions.has(String(expense.description || '').trim().toLocaleLowerCase());
}

function recordTravelTagSuppressions(metadata, selectedCategories) {
  const travelTags = metadata?.travelTags && typeof metadata.travelTags === 'object' && !Array.isArray(metadata.travelTags)
    ? metadata.travelTags : {};
  const suppressions = metadata?.travelTagSuppressions && typeof metadata.travelTagSuppressions === 'object' && !Array.isArray(metadata.travelTagSuppressions)
    ? { ...metadata.travelTagSuppressions } : {};
  const selectedNames = new Set((Array.isArray(selectedCategories) ? selectedCategories : [])
    .map(name => String(name || '').trim().toLocaleLowerCase()).filter(Boolean));

  for (const [planId, planName] of Object.entries(travelTags)) {
    if (selectedNames.has(String(planName || '').trim().toLocaleLowerCase())) delete suppressions[planId];
    else suppressions[planId] = true;
  }
  return suppressions;
}

function travelTagAssignment(expense, metadata, plans, subscriptions, excludedCategories = new Set()) {
  const priorTravelTags = metadata.travelTags && typeof metadata.travelTags === 'object' && !Array.isArray(metadata.travelTags) ? metadata.travelTags : {};
  const priorSuppressions = metadata.travelTagSuppressions && typeof metadata.travelTagSuppressions === 'object' && !Array.isArray(metadata.travelTagSuppressions)
    ? metadata.travelTagSuppressions : {};
  const activePlanIds = new Set(plans.map(plan => String(plan.id)));
  const travelTagSuppressions = Object.fromEntries(Object.entries(priorSuppressions)
    .filter(([planId, suppressed]) => activePlanIds.has(String(planId)) && Boolean(suppressed)));
  const priorNames = new Set(Object.values(priorTravelTags));
  const priorTravelCategoryApplied = metadata.travelCategoryApplied === true;
  const categories = metadata.categories.filter(name => !priorNames.has(name)
    && !(priorTravelCategoryApplied && String(name).toLocaleLowerCase() === TRAVEL_CATEGORY.toLocaleLowerCase())
    && !isUncategorized(name));
  const travelTags = {};
  if (!isRoutineExpense(expense, metadata, subscriptions, excludedCategories)) {
    for (const plan of plans) {
      if (!travelTagSuppressions[plan.id] && expense.date >= plan.startDate && expense.date <= plan.endDate) {
        travelTags[plan.id] = plan.name;
      }
    }
  }
  const priorPrimary = String(metadata.mainCategory || '').trim();
  const priorPrimaryWasTravel = [...priorNames].some(name => String(name).toLocaleLowerCase() === priorPrimary.toLocaleLowerCase());
  const assignedTravelNames = Object.values(travelTags);
  const hasTravelCategory = categories.some(name => String(name).toLocaleLowerCase() === TRAVEL_CATEGORY.toLocaleLowerCase());
  const travelCategoryApplied = assignedTravelNames.length > 0 && (priorTravelCategoryApplied || !hasTravelCategory);
  if (assignedTravelNames.length && !hasTravelCategory) categories.push(TRAVEL_CATEGORY);
  for (const travelName of assignedTravelNames) {
    if (!categories.some(name => String(name).toLocaleLowerCase() === String(travelName).toLocaleLowerCase())) categories.push(travelName);
  }
  const priorPrimaryWasDerivedTravel = priorPrimaryWasTravel
    || (priorTravelCategoryApplied && priorPrimary.toLocaleLowerCase() === TRAVEL_CATEGORY.toLocaleLowerCase());
  const mainCategory = (!priorPrimary || isUncategorized(priorPrimary) || priorPrimaryWasDerivedTravel)
    ? assignedTravelNames.length ? TRAVEL_CATEGORY : categories[0] || ''
    : priorPrimary;
  return normalizeExpenseCategories({ ...metadata, categories, mainCategory, travelTags, travelTagSuppressions, travelCategoryApplied });
}

function applyTravelPlansToExpense(userId, stored, plans = ownedTravelPlans(userId), subscriptions = subscriptionDescriptions(userId), excludedCategories = excludedCategoryNames(userId)) {
  if (!stored || stored.hiddenAt) return false;
  const expense = revealExpenseRecord(sqlite, stored);
  let parsed = {};
  try { parsed = expense.data ? JSON.parse(expense.data) : {}; } catch { /* Normalize malformed legacy metadata. */ }
  const metadata = normalizeExpenseCategories(parsed);
  const priorTravelTags = metadata.travelTags && typeof metadata.travelTags === 'object' ? metadata.travelTags : {};
  const priorTravelTagSuppressions = metadata.travelTagSuppressions && typeof metadata.travelTagSuppressions === 'object'
    ? metadata.travelTagSuppressions : {};
  const normalized = travelTagAssignment(expense, metadata, plans, subscriptions, excludedCategories);
  if (JSON.stringify(metadata.categories) === JSON.stringify(normalized.categories)
    && metadata.mainCategory === normalized.mainCategory
    && metadata.travelCategoryApplied === normalized.travelCategoryApplied
    && JSON.stringify(priorTravelTags) === JSON.stringify(normalized.travelTags)
    && JSON.stringify(priorTravelTagSuppressions) === JSON.stringify(normalized.travelTagSuppressions)) return false;
  db.update(expenses).set(protectExpenseRecord(sqlite, userId, {
    description: expense.description,
    amount: expense.amount,
    category: normalized.mainCategory,
    date: expense.date,
    data: JSON.stringify(normalized),
  })).where(eq(expenses.id, expense.id)).run();
  return true;
}

function reapplyTravelPlans(userId) {
  const plans = ownedTravelPlans(userId);
  const subscriptions = subscriptionDescriptions(userId);
  const exclusions = excludedCategoryNames(userId);
  let updated = 0;
  for (const spending of db.select().from(monthlySpending).where(eq(monthlySpending.userId, userId)).all()) {
    for (const expense of db.select().from(expenses).where(eq(expenses.spendingId, spending.id)).all()) {
      if (applyTravelPlansToExpense(userId, expense, plans, subscriptions, exclusions)) updated += 1;
    }
  }
  for (const categoryName of [TRAVEL_CATEGORY, ...plans.map(plan => plan.name)]) {
    const existing = db.select().from(categories).where(eq(categories.userId, userId)).all()
      .some(category => category.name.toLocaleLowerCase() === categoryName.toLocaleLowerCase());
    if (!existing) {
      try { db.insert(categories).values({ userId, name: categoryName, color: TRAVEL_COLOR }).run(); }
      catch (error) { if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error; }
    }
  }
  return updated;
}

module.exports = { publicTravelPlan, protectedTravelPlan, ownedTravelPlans, travelPreferenceCategoryIds, saveTravelPreferenceCategoryIds, isRoutineExpense, recordTravelTagSuppressions, travelTagAssignment, applyTravelPlansToExpense, reapplyTravelPlans };
