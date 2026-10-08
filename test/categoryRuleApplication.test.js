const test = require('node:test');
const assert = require('node:assert/strict');
const { replaceExpenseCategories, ruleMatchesPurchase } = require('../server/lib/categoryRuleApplication');

test('categorization rules replace unrelated purchase tags with the saved tag set', () => {
  const result = replaceExpenseCategories({
    source: 'simplefin',
    categories: ['Shopping', 'Old tag'],
    mainCategory: 'Shopping',
  }, ['Travel', 'Air Travel']);
  assert.deepEqual(result.metadata, {
    source: 'simplefin',
    categories: ['Travel', 'Air Travel'],
    mainCategory: 'Travel',
  });
  assert.equal(result.changed, true);
});

test('reapplying an identical categorization rule is idempotent', () => {
  const first = replaceExpenseCategories({ source: 'simplefin' }, ['Travel', 'Air Travel']);
  const second = replaceExpenseCategories(first.metadata, ['Travel', 'Air Travel']);
  assert.equal(second.changed, false);
  assert.deepEqual(second.metadata, first.metadata);
});

test('categorization rules match purchases from their effective date regardless of source', () => {
  const rule = { normalizedMerchant: 'airbnb', effectiveFrom: '2026-06-01' };
  assert.equal(ruleMatchesPurchase(rule, 'AIRBNB * HMQBSCNH8M', '2026-06-01'), true);
  assert.equal(ruleMatchesPurchase(rule, 'AIRBNB * HMQBSCNH8M', '2026-08-04'), true);
  assert.equal(ruleMatchesPurchase(rule, 'AIRBNB * HMQBSCNH8M', '2026-05-31'), false);
  assert.equal(ruleMatchesPurchase(rule, 'Unrelated hotel', '2026-08-04'), false);
});
