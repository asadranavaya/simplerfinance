const { eq } = require('drizzle-orm');
const { db } = require('../db');
const { accounts, categories, defaultCategories } = require('../db/schema');

const DEFAULT_COLORS = ['#28a745','#007bff','#dc3545','#ffc107','#17a2b8','#6f42c1','#fd7e14','#6c757d'];

function normalizedKey(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function sharedDefaults() {
  return db.select().from(defaultCategories).all().sort((a, b) => a.name.localeCompare(b.name));
}

function defaultByName(value) {
  const key = normalizedKey(value);
  return sharedDefaults().find(category => category.normalizedName === key) || null;
}

function ensureDefaultsForAccount(userId) {
  const owned = db.select().from(categories).where(eq(categories.userId, userId)).all();
  const existing = new Set(owned.map(category => normalizedKey(category.name)));
  for (const category of sharedDefaults()) {
    if (existing.has(category.normalizedName)) continue;
    db.insert(categories).values({ userId, name: category.name, color: category.color }).run();
    existing.add(category.normalizedName);
  }
  return db.select().from(categories).where(eq(categories.userId, userId)).all();
}

function materializeDefaultForAllAccounts(category) {
  for (const account of db.select({ id: accounts.id }).from(accounts).all()) {
    const owned = db.select().from(categories).where(eq(categories.userId, account.id)).all();
    if (owned.some(item => normalizedKey(item.name) === category.normalizedName)) continue;
    db.insert(categories).values({ userId: account.id, name: category.name, color: category.color }).run();
  }
}

function categoryCandidates() {
  const defaults = new Set(sharedDefaults().map(category => category.normalizedName));
  const candidates = new Map();
  for (const category of db.select().from(categories).all()) {
    const key = normalizedKey(category.name);
    if (!key || key === 'uncategorized' || defaults.has(key) || candidates.has(key)) continue;
    candidates.set(key, { name: category.name, normalizedName: key, color: category.color || DEFAULT_COLORS[candidates.size % DEFAULT_COLORS.length] });
  }
  return [...candidates.values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { DEFAULT_COLORS, normalizedKey, sharedDefaults, defaultByName, ensureDefaultsForAccount, materializeDefaultForAllAccounts, categoryCandidates };
