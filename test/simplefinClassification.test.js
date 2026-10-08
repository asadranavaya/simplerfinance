const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyTransaction } = require('../server/lib/simplefinClassification');

test('classifies ordinary spending, income, refunds, and uncertain rails', () => {
  assert.equal(classifyTransaction({ amount: '-12', pending: false, description: 'Coffee', postedAt: '2026-08-01' }, 'bank').classification, 'expense');
  assert.equal(classifyTransaction({ amount: '1000', pending: false, description: 'Payroll', postedAt: '2026-08-01' }, 'bank').classification, 'income');
  assert.equal(classifyTransaction({ amount: '12', pending: false, description: 'Merchant refund', postedAt: '2026-08-01' }, 'credit_card').classification, 'refund');
  assert.equal(classifyTransaction({ amount: '-20', pending: false, description: 'Zelle Alex', postedAt: '2026-08-01' }, 'bank').classification, 'review');
});

test('matches linked bank-to-card counterparts as a card payment', () => {
  const transaction = { id: 'bank-tx', simplefinAccountId: 'bank', amount: '-500', pending: false, description: 'Payment', postedAt: '2026-08-01' };
  const counterpart = { id: 'card-tx', simplefinAccountId: 'card', amount: '500', pending: false, description: 'Payment received', postedAt: '2026-08-02' };
  const result = classifyTransaction(transaction, 'bank', [transaction, counterpart], new Map([['bank', 'bank'], ['card', 'credit_card']]));
  assert.equal(result.classification, 'card_payment');
});
