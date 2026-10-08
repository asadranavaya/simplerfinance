const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeTransactions } = require('../server/lib/simplefinTransactionSummary');

test('summarizes staged transaction lifecycle without exposing transaction details', () => {
  const summary = summarizeTransactions([
    { amount: '-10.00', pending: false, expenseId: 'expense-1', postedAt: '2026-08-01T00:00:00.000Z', description: 'private' },
    { amount: '-12.00', pending: true, expenseId: null, postedAt: '2026-08-02T00:00:00.000Z' },
    { amount: '100.00', pending: false, expenseId: null, postedAt: '2026-08-03T00:00:00.000Z' },
  ]);
  assert.deepEqual(summary, {
    total: 3, postedOutflows: 1, pending: 1, positive: 1, imported: 1,
    earliestPostedAt: '2026-08-01T00:00:00.000Z', latestPostedAt: '2026-08-03T00:00:00.000Z',
  });
  assert.equal('description' in summary, false);
});
