const test = require('node:test');
const assert = require('node:assert/strict');
const { customerPaidAmount } = require('../server/lib/expenseAmounts');

test('split percentages and amounts return the customer-paid remainder', () => {
  assert.equal(customerPaidAmount(100, { mode: 'percent', allocations: [{ value: 25 }, { value: 15 }] }), 60);
  assert.equal(customerPaidAmount(100, { mode: 'amount', allocations: [{ value: 25 }, { value: 15 }] }), 60);
  assert.equal(customerPaidAmount(-100, { mode: 'percent', allocations: [{ value: 25 }] }), -75);
  assert.equal(customerPaidAmount(100, null), 100);
});
