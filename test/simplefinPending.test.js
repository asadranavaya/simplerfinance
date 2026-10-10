const test = require('node:test');
const assert = require('node:assert/strict');
const { accountResponseHasErrors, missingPendingTransactions, pendingReplacementCandidate, transactionTimestamps } = require('../server/lib/simplefinSync');

test('retains transaction time separately and uses it when a pending item has no posted time', () => {
  const transacted = Date.parse('2026-08-05T14:37:00.000Z') / 1000;
  assert.deepEqual(transactionTimestamps({ posted: 0, transacted_at: transacted, pending: true }), {
    postedAt: '2026-08-05T14:37:00.000Z',
    transactedAt: '2026-08-05T14:37:00.000Z',
  });
  assert.deepEqual(transactionTimestamps({ posted: transacted + 3600, transacted_at: transacted, pending: false }), {
    postedAt: '2026-08-05T15:37:00.000Z',
    transactedAt: '2026-08-05T14:37:00.000Z',
  });
});

test('reconciles one strong pending-to-posted candidate with a changed remote ID', () => {
  const rows = [{ id: 'local-1', pending: true, amount: '-12.34', postedAt: '2026-08-05T00:00:00.000Z', description: 'PENDING CARD COFFEE SHOP' }];
  const match = pendingReplacementCandidate(rows, {
    id: 'posted-2', pending: false, amount: '-12.34', posted: Date.parse('2026-08-06T00:00:00.000Z') / 1000,
    description: 'Coffee Shop Purchase',
  });
  assert.equal(match?.id, 'local-1');
});

test('does not guess when pending replacement candidates are ambiguous', () => {
  const rows = [
    { id: 'one', pending: true, amount: '-20.00', postedAt: '2026-08-05T00:00:00.000Z', description: 'Market' },
    { id: 'two', pending: true, amount: '-20.00', postedAt: '2026-08-05T00:00:00.000Z', description: 'Market' },
  ];
  const match = pendingReplacementCandidate(rows, {
    pending: false, amount: '-20.00', posted: Date.parse('2026-08-06T00:00:00.000Z') / 1000, description: 'Market',
  });
  assert.equal(match, null);
});

test('retires recent pending transactions absent from a successfully covered response window', () => {
  const staged = [
    { id: 'missing', remoteTransactionId: 'pending-1', pending: true, postedAt: '2026-08-15T12:00:00.000Z' },
    { id: 'present', remoteTransactionId: 'pending-2', pending: true, postedAt: '2026-08-15T13:00:00.000Z' },
    { id: 'posted', remoteTransactionId: 'posted-1', pending: false, postedAt: '2026-08-15T14:00:00.000Z' },
  ];
  const missing = missingPendingTransactions(staged, [{ id: 'pending-2', pending: true }], {
    startDate: Date.parse('2026-08-10T00:00:00.000Z') / 1000,
    endDate: Date.parse('2026-08-20T00:00:00.000Z') / 1000,
  }, new Date('2026-08-19T12:00:00.000Z'));
  assert.deepEqual(missing.map(transaction => transaction.id), ['missing']);
});

test('does not retire pending transactions outside the covered window or reconciliation horizon', () => {
  const staged = [
    { id: 'outside-window', remoteTransactionId: 'pending-1', pending: true, postedAt: '2026-08-09T23:59:59.000Z' },
    { id: 'too-old', remoteTransactionId: 'pending-2', pending: true, postedAt: '2026-08-01T12:00:00.000Z' },
  ];
  const missing = missingPendingTransactions(staged, [], {
    startDate: Date.parse('2026-08-10T00:00:00.000Z') / 1000,
    endDate: Date.parse('2026-08-20T00:00:00.000Z') / 1000,
  }, new Date('2026-08-19T12:00:00.000Z'));
  assert.deepEqual(missing, []);
});

test('account-scoped provider errors block only the affected account', () => {
  const accountSet = { errlist: [{ code: 'act.missingdata', account_id: 'failed-account', msg: 'Incomplete transactions' }] };
  assert.equal(accountResponseHasErrors(accountSet, { id: 'failed-account', conn_id: 'connection-1' }), true);
  assert.equal(accountResponseHasErrors(accountSet, { id: 'healthy-account', conn_id: 'connection-1' }), false);
});

test('connection-scoped errors block that connection while unscoped errors block every account', () => {
  const connectionError = { errlist: [{ code: 'con.auth', conn_id: 'failed-connection', msg: 'Authentication required' }] };
  assert.equal(accountResponseHasErrors(connectionError, { id: 'account-1', conn_id: 'failed-connection' }), true);
  assert.equal(accountResponseHasErrors(connectionError, { id: 'account-prefixed', conn_id: 'MX-failed-connection' }), true);
  assert.equal(accountResponseHasErrors(connectionError, { id: 'account-2', conn_id: 'healthy-connection' }), false);
  assert.equal(accountResponseHasErrors({ errlist: [{ code: 'gen.', msg: 'General error' }] }, { id: 'account-2' }), true);
  assert.equal(accountResponseHasErrors({ errors: ['Legacy unscoped error'] }, { id: 'account-2' }), true);
});
