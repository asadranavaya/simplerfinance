const test = require('node:test');
const assert = require('node:assert/strict');
const { isImportedExpenseForTransactions } = require('../server/lib/simplefinDeletion');

test('permanent deletion selects only proven SimpleFIN-imported expenses', () => {
  const transactionIds = new Set(['transaction-1']);
  assert.equal(isImportedExpenseForTransactions({
    data: JSON.stringify({ source: 'simplefin', simplefinTransactionId: 'transaction-1' }),
  }, transactionIds), true);
  assert.equal(isImportedExpenseForTransactions({
    data: JSON.stringify({ source: 'manual', simplefinTransactionId: 'transaction-1' }),
  }, transactionIds), false);
  assert.equal(isImportedExpenseForTransactions({ data: '{broken' }, transactionIds), false);
});

test('permanent deletion does not select imports belonging to another connection', () => {
  const transactionIds = new Set(['transaction-1']);
  assert.equal(isImportedExpenseForTransactions({
    data: JSON.stringify({ source: 'simplefin', simplefinTransactionId: 'transaction-2' }),
  }, transactionIds), false);
});
