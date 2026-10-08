const test = require('node:test');
const assert = require('node:assert/strict');
const { extractProviderCategories } = require('../server/lib/simplefinProviderCategories');

test('extracts provider-defined transaction categories from common extra shapes', () => {
  assert.deepEqual(extractProviderCategories({ category: 'Food' }), ['Food']);
  assert.deepEqual(extractProviderCategories({ categories: ['Travel', 'Air Travel'] }), ['Travel', 'Air Travel']);
  assert.deepEqual(extractProviderCategories({
    merchant: { personalFinanceCategory: { primary: 'Travel', detailed: 'Air Travel' } },
  }), ['Travel', 'Air Travel']);
});

test('provider categories are bounded, deduplicated, and ignore unrelated fields', () => {
  const result = extractProviderCategories({
    description: 'Not a category',
    category: ['Food', 'food', 'A', 'B', 'C', 'D', 'E', 'F'],
    unrelated: { label: 'Also not a category' },
  });
  assert.deepEqual(result, ['Food', 'A', 'B', 'C', 'D']);
});
