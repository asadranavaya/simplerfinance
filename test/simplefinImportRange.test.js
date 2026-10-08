const test = require('node:test');
const assert = require('node:assert/strict');
const { validatedImportDate } = require('../server/lib/simplefinImportRange');

const now = new Date('2026-08-07T12:00:00.000Z');

test('accepts valid SimpleFIN import dates within the two-year range', () => {
  assert.equal(validatedImportDate('2026-08-07', now), '2026-08-07');
  assert.equal(validatedImportDate('2024-08-07', now), '2024-08-07');
});

test('rejects future, overlong, and malformed import ranges', () => {
  assert.equal(validatedImportDate('2026-08-08', now), null);
  assert.equal(validatedImportDate('2024-08-06', now), null);
  assert.equal(validatedImportDate('2026-02-30', now), null);
  assert.equal(validatedImportDate('08/07/2026', now), null);
});
