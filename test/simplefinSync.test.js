const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTransactionWindows, deduplicateWarnings, remoteAccountValues, transactionSyncStart } = require('../server/lib/simplefinSync');

test('deduplicates a provider warning repeated across account responses', () => {
  const warning = { code: 'account_unavailable', message: 'One linked account could not be refreshed.' };
  assert.deepEqual(deduplicateWarnings([warning, { ...warning }, { code: 'other', message: 'Different issue.' }]), [
    warning,
    { code: 'other', message: 'Different issue.' },
  ]);
});

test('creates a single inclusive-current-day transaction window', () => {
  const windows = buildTransactionWindows('2026-08-01', new Date('2026-08-07T18:00:00Z'));
  assert.deepEqual(windows, [{
    startDate: Date.parse('2026-08-01T00:00:00Z') / 1000,
    endDate: Date.parse('2026-08-08T00:00:00Z') / 1000,
  }]);
});

test('caps provider windows at 45 days and overlaps them by five days', () => {
  const windows = buildTransactionWindows('2026-01-01', new Date('2026-08-07T00:00:00Z'));
  assert.ok(windows.length > 1);
  for (const window of windows) {
    assert.ok(window.endDate - window.startDate <= 45 * 24 * 60 * 60);
  }
  for (let index = 1; index < windows.length; index += 1) {
    assert.equal(windows[index - 1].endDate - windows[index].startDate, 5 * 24 * 60 * 60);
  }
});

test('uses the import boundary once, then rechecks fourteen days for pending reconciliation', () => {
  assert.equal(transactionSyncStart({ transactionImportFrom: '2026-06-01', transactionSyncedThrough: null }).toISOString(), '2026-06-01T00:00:00.000Z');
  assert.equal(transactionSyncStart({ transactionImportFrom: '2026-06-01', transactionSyncedThrough: '2026-08-07' }).toISOString(), '2026-07-24T00:00:00.000Z');
  assert.equal(transactionSyncStart({ transactionImportFrom: '2026-08-05', transactionSyncedThrough: '2026-08-07' }).toISOString(), '2026-08-05T00:00:00.000Z');
});

test('normal sync can stage an account that was discovered after initial setup', () => {
  const now = '2026-08-07T05:00:00.000Z';
  const values = remoteAccountValues('connection-1', {
    id: 'new-remote-account',
    name: 'New savings account',
    conn_id: 'institution-1',
    currency: 'USD',
    balance: '250.75',
    'balance-date': 1786078800,
  }, new Map([['institution-1', 'Example Bank']]), now);

  assert.equal(values.connectionId, 'connection-1');
  assert.equal(values.remoteAccountId, 'new-remote-account');
  assert.equal(values.institutionName, 'Example Bank');
  assert.equal(values.balance, '250.75');
  assert.equal(values.firstSeenAt, now);
  assert.equal(values.isActive, true);
});
