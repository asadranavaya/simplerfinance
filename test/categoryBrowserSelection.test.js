const test = require('node:test');
const assert = require('node:assert/strict');

test('combined category results include a multi-tag purchase only once', async () => {
  const { selectCategoryExpenses } = await import('../renderer/src/util/categoryBrowserSelection.js');
  const purchase = { id: 'purchase-1', cardId: 'card-1', amount: 24, categories: ['Food', 'Drink'], mainCategory: 'Food' };
  const results = selectCategoryExpenses([purchase, { ...purchase }], ['Food', 'Drink']);
  assert.equal(results.length, 1);
  assert.equal(results[0].displayCategory, 'Food');
  assert.equal(results.reduce((total, expense) => total + expense.amount, 0), 24);
});

test('display category prefers a selected main category and otherwise uses any selected match', async () => {
  const { displayCategoryForExpense } = await import('../renderer/src/util/categoryBrowserSelection.js');
  assert.equal(displayCategoryForExpense({ categories: ['Food', 'Drink'], mainCategory: 'Drink' }, ['Food', 'Drink']), 'Drink');
  assert.equal(displayCategoryForExpense({ categories: ['Food', 'Drink'], mainCategory: 'Travel' }, ['Drink', 'Food']), 'Food');
  assert.equal(displayCategoryForExpense({ categories: ['Travel'], mainCategory: 'Travel' }, ['Food', 'Drink']), null);
});
