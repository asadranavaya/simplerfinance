const test = require('node:test');
const assert = require('node:assert/strict');
const { ACCOUNT_NAME_MAX_LENGTH, validateAccountName } = require('../server/lib/accountName');

test('account display names are trimmed and limited to 50 characters', () => {
  assert.equal(ACCOUNT_NAME_MAX_LENGTH, 50);
  assert.deepEqual(validateAccountName('  Jane Doe  '), { name: 'Jane Doe' });
  assert.equal(validateAccountName('x'.repeat(50)).name.length, 50);
  assert.match(validateAccountName('x'.repeat(51)).error, /50 characters or fewer/);
});

test('account display names cannot be empty', () => {
  assert.match(validateAccountName('   ').error, /required/);
  assert.match(validateAccountName(null).error, /required/);
});
