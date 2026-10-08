const test = require('node:test');
const assert = require('node:assert/strict');
const { expenseDate, stableMonthlySequence, recurringMonthlyHistory } = require('../server/lib/subscriptionDetection');

test('subscription detection preserves an expense payment day', () => {
  assert.equal(expenseDate({ year: 2026, month: 8, date: '2026-08-17' }), '2026-08-17');
  assert.equal(expenseDate({ year: 2026, month: 8, date: 'invalid' }), '2026-08-01');
});

test('subscription detection requires stable amounts across consecutive months', () => {
  const expenses = [
    { year: 2026, month: 1, date: '2026-01-05', amount: 19.99 },
    { year: 2026, month: 2, date: '2026-02-05', amount: 21.49 },
    { year: 2026, month: 3, date: '2026-03-05', amount: 20.25 },
  ];
  assert.equal(stableMonthlySequence(expenses).length, 3);
  expenses[1].amount = 29.99;
  assert.equal(stableMonthlySequence(expenses).length, 1);
});

test('stable subscription matching ignores unrelated purchases at the same merchant', () => {
  const stable = [
    { year: 2026, month: 1, date: '2026-01-02', amount: 14.99, id: 'jan' },
    { year: 2026, month: 2, date: '2026-02-02', amount: 15.99, id: 'feb' },
    { year: 2026, month: 3, date: '2026-03-02', amount: 14.49, id: 'mar' },
  ];
  const purchases = [stable[0], { year: 2026, month: 2, date: '2026-02-14', amount: 72, id: 'other' }, stable[1], stable[2]];
  assert.deepEqual(stableMonthlySequence(purchases).map(expense => expense.id), ['jan', 'feb', 'mar']);
});

test('recurring history retains compatible payments across gaps and favors recent activity', () => {
  const payment = (year, month, amount = 13.23) => ({ year, month, amount, date: `${year}-${String(month).padStart(2, '0')}-15` });
  const recurring = recurringMonthlyHistory([
    payment(2025, 7), payment(2025, 8), payment(2025, 9), payment(2025, 10),
    payment(2026, 1, 14.36), payment(2026, 2, 14.36), payment(2026, 3, 14.36), payment(2026, 4, 14.36),
    payment(2026, 6, 14.36), payment(2026, 7, 14.36),
  ]);
  assert.equal(recurring.consecutiveMonths, 4);
  assert.equal(recurring.history.length, 10);
  assert.equal(recurring.history.at(-1).month, 7);
});

test('recurring history uses only one compatible charge per month', () => {
  const recurring = recurringMonthlyHistory([
    { year: 2026, month: 5, amount: 9, date: '2026-05-10' },
    { year: 2026, month: 6, amount: 9, date: '2026-06-10' },
    { year: 2026, month: 7, amount: 9, date: '2026-07-10' },
    { year: 2026, month: 7, amount: 9, date: '2026-07-11' },
    { year: 2026, month: 8, amount: 9, date: '2026-08-10' },
  ]);
  assert.equal(recurring.history.length, 4);
  assert.equal(recurring.consecutiveMonths, 4);
});

test('monthly payment estimates preserve the observed day and clamp month end', async () => {
  const { nextEstimatedPayment, projectedDateForMonth } = await import('../renderer/src/util/subscriptionCalendar.js');
  assert.equal(nextEstimatedPayment('2026-07-17', new Date('2026-08-08T12:00:00Z')).toISOString().slice(0, 10), '2026-08-17');
  assert.equal(nextEstimatedPayment('2026-07-01', new Date('2026-08-08T12:00:00Z')).toISOString().slice(0, 10), '2026-09-01');
  assert.equal(projectedDateForMonth('2026-01-31', 2026, 1).toISOString().slice(0, 10), '2026-02-28');
});
