const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { normalizedCategoryName } = require('../server/lib/categoryValidation');

test('normalizes valid user-owned category names', () => {
  assert.equal(normalizedCategoryName('  Dining   Out  '), 'Dining Out');
});

test('rejects empty and oversized category names', () => {
  assert.equal(normalizedCategoryName('   '), null);
  assert.equal(normalizedCategoryName('x'.repeat(81)), null);
});

test('category uniqueness and updates are isolated per account', () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE categories (
    id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE,
    color TEXT NOT NULL, UNIQUE(user_id, name)
  )`);
  sqlite.prepare('INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)').run('user-a', 'Groceries', '#111111');
  sqlite.prepare('INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)').run('user-b', 'Groceries', '#222222');
  sqlite.prepare('UPDATE categories SET color = ? WHERE user_id = ? AND name = ?').run('#333333', 'user-a', 'Groceries');
  assert.equal(sqlite.prepare('SELECT color FROM categories WHERE user_id = ?').get('user-a').color, '#333333');
  assert.equal(sqlite.prepare('SELECT color FROM categories WHERE user_id = ?').get('user-b').color, '#222222');
  sqlite.close();
});

test('merchant rules may reuse the same normalized merchant across accounts', () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE category_rules (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, normalized_merchant TEXT NOT NULL,
    category_id INTEGER NOT NULL, UNIQUE(user_id, normalized_merchant)
  )`);
  sqlite.prepare('INSERT INTO category_rules VALUES (?, ?, ?, ?)').run('rule-a', 'user-a', 'coffee shop', 1);
  sqlite.prepare('INSERT INTO category_rules VALUES (?, ?, ?, ?)').run('rule-b', 'user-b', 'coffee shop', 2);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM category_rules').get().count, 2);
  assert.throws(() => sqlite.prepare('INSERT INTO category_rules VALUES (?, ?, ?, ?)').run('rule-c', 'user-a', 'coffee shop', 3));
  sqlite.close();
});
