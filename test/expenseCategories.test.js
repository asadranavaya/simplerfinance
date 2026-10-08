const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeExpenseCategories } = require('../server/lib/expenseCategories');

test('uncategorized is removed whenever a real expense category exists', () => {
  assert.deepEqual(normalizeExpenseCategories({
    categories: ['Uncategorized', 'Travel', 'Air Travel'],
    mainCategory: 'Uncategorized',
  }), {
    categories: ['Travel', 'Air Travel'],
    mainCategory: 'Travel',
  });
});

test('uncategorized is derived when an expense has no real categories', () => {
  assert.deepEqual(normalizeExpenseCategories({ categories: [], mainCategory: '' }), {
    categories: ['Uncategorized'],
    mainCategory: 'Uncategorized',
  });
});
