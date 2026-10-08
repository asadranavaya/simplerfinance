const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDescription,
  descriptionSimilarity,
  decimalToCents,
  isMaterializableTransaction,
  refreshedImportedCategories,
  refreshedImportedDescription,
} = require('../server/lib/simplefinMaterialize');
const { merchantMatches, suggestedMerchant } = require('../server/lib/merchantRules');

test('normalizes common card transaction noise', () => {
  assert.equal(normalizeDescription('POS PURCHASE — Coffee-Shop #42'), 'coffee shop 42');
  assert.equal(descriptionSimilarity('CARD PURCHASE NETFLIX.COM', 'Netflix com'), 1);
});

test('scores unrelated descriptions below similar merchant descriptions', () => {
  const similar = descriptionSimilarity('SQ *CORNER COFFEE 1234', 'Corner Coffee');
  const unrelated = descriptionSimilarity('SQ *CORNER COFFEE 1234', 'City Electric Utility');
  assert.ok(similar > unrelated);
  assert.equal(unrelated, 0);
});

test('suggests editable stable merchant patterns for changing Amazon references', () => {
  assert.equal(suggestedMerchant('AMAZON MKTPL*9K9E30Z73'), 'Amazon');
  assert.equal(suggestedMerchant('AMAZON MKTPL*VX0OC1BB3'), 'Amazon');
  assert.equal(merchantMatches('AMAZON MKTPL*VX0OC1BB3', 'Amazon'), true);
  assert.equal(merchantMatches('AMAZONIAN CAFE', 'Amazon'), false);
});

test('converts provider decimals to exact cents with rounding', () => {
  assert.equal(decimalToCents('-42.50'), -4250n);
  assert.equal(decimalToCents('10'), 1000n);
  assert.equal(decimalToCents('1.005'), 101n);
  assert.equal(decimalToCents('not-money'), null);
});

test('shows pending outflows while excluding pending credits until classified', () => {
  assert.equal(isMaterializableTransaction({ pending: true, classification: 'pending', amount: '-12.34' }), true);
  assert.equal(isMaterializableTransaction({ pending: true, classification: 'pending', amount: '12.34' }), false);
  assert.equal(isMaterializableTransaction({ pending: false, classification: 'expense', amount: '-12.34' }), true);
});

test('posted transactions replace an untouched pending provider description', () => {
  assert.equal(refreshedImportedDescription(
    'UBR PENDING.UBER.COM',
    { providerDescription: 'UBR PENDING.UBER.COM' },
    'UBER *TRIP HELP.UBER.COM'
  ), 'UBER *TRIP HELP.UBER.COM');
});

test('posted transactions preserve a customer-edited merchant description', () => {
  assert.equal(refreshedImportedDescription(
    'Uber',
    { providerDescription: 'UBR PENDING.UBER.COM' },
    'UBER *TRIP HELP.UBER.COM'
  ), 'Uber');
});

test('a later sync repairs an already-posted expense still showing its pending descriptor', () => {
  assert.equal(refreshedImportedDescription(
    'UBR PENDING.UBER.COM',
    { providerDescription: 'UBER *TRIP HELP.UBER.COM', providerPending: false },
    'UBER *TRIP HELP.UBER.COM'
  ), 'UBER *TRIP HELP.UBER.COM');
});

test('provider categories replace uncategorized while trip tags remain additive', () => {
  const result = refreshedImportedCategories({
    categories: ['Seattle Trip'], mainCategory: 'Seattle Trip', categorySource: 'uncategorized',
    providerCategories: [], travelTags: { trip: 'Seattle Trip' },
  }, {
    source: 'provider', providerNames: ['Food'],
    categories: [{ name: 'Food' }], primary: { name: 'Food' },
  });
  assert.deepEqual(result.categories, ['Food', 'Seattle Trip']);
  assert.equal(result.mainCategory, 'Food');
  assert.equal(result.categorySource, 'provider');
});

test('customer categories and merchant rules take precedence over provider categories', () => {
  const customer = refreshedImportedCategories({
    categories: ['Dining', 'Seattle Trip'], mainCategory: 'Dining', categorySource: 'customer',
    providerCategories: ['Food'], travelTags: { trip: 'Seattle Trip' },
  }, { source: 'provider', providerNames: ['Restaurant'], categories: [{ name: 'Restaurant' }] });
  assert.deepEqual(customer.categories, ['Dining', 'Seattle Trip']);

  const rule = refreshedImportedCategories(customer, {
    source: 'customer_rule', providerNames: ['Restaurant'], categories: [{ name: 'Business Meal' }],
  });
  assert.deepEqual(rule.categories, ['Business Meal', 'Seattle Trip']);
});
