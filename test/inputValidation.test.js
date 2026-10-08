const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanId, cleanNumber, cleanText, hasOnlyKeys, isIsoDate } = require('../server/middleware/inputValidation');

test('input primitives enforce length, numeric, date, and identifier boundaries', () => {
  assert.equal(cleanText('  hello  ', { max: 10, required: true }).value, 'hello');
  assert.match(cleanText('x'.repeat(11), { label: 'Name', max: 10 }).error, /10 characters/);
  assert.equal(cleanNumber('12.50', { min: 0, max: 20 }).value, 12.5);
  assert.ok(cleanNumber(Infinity).error);
  assert.ok(cleanNumber(21, { min: 0, max: 20 }).error);
  assert.equal(isIsoDate('2026-02-28'), true);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(cleanId('valid_id-123').value, 'valid_id-123');
  assert.ok(cleanId('../invalid').error);
});

test('strict objects reject unsupported fields', () => {
  assert.equal(hasOnlyKeys({ name: 'Goal' }, ['name']), true);
  assert.equal(hasOnlyKeys({ name: 'Goal', userId: 'someone-else' }, ['name']), false);
  assert.equal(hasOnlyKeys([], ['name']), false);
});
