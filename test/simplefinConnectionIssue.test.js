const test = require('node:test');
const assert = require('node:assert/strict');
const { simplefinConnectionIssue, storedMessages } = require('../server/lib/simplefinConnectionIssue');

test('healthy SimpleFIN connections do not report an issue', () => {
  assert.equal(simplefinConnectionIssue({ status: 'active', lastError: null }, { isStale: false }), null);
  assert.equal(simplefinConnectionIssue({ status: 'syncing', lastError: null }, { isStale: false }), null);
});

test('provider warnings are summarized for the account tooltip', () => {
  const lastError = JSON.stringify([
    { code: 'account_unavailable', message: 'Balance temporarily unavailable.' },
    { code: 'transactions_delayed', message: 'Transactions are delayed.' },
    { code: 'provider_notice', message: 'Try again later.' },
  ]);
  assert.equal(
    simplefinConnectionIssue({ status: 'active', lastError }, { isStale: false }),
    'Balance temporarily unavailable. • Transactions are delayed. • 1 more issue'
  );
});

test('account-scoped warnings only flag the affected linked account', () => {
  const lastError = JSON.stringify([
    { code: 'account_unavailable', message: 'Checking account could not refresh.', accountId: 'remote-checking' },
  ]);
  const connection = { status: 'active', lastError };
  assert.equal(
    simplefinConnectionIssue(connection, { remoteAccountId: 'remote-checking' }),
    'Checking account could not refresh.'
  );
  assert.equal(simplefinConnectionIssue(connection, { remoteAccountId: 'remote-savings' }), null);
});

test('connection warnings match provider-prefixed account connection IDs', () => {
  const lastError = JSON.stringify([
    { code: 'con.auth', message: 'Apple Card authentication is required.', connectionId: 'MBR-connection-1' },
  ]);
  assert.equal(
    simplefinConnectionIssue(
      { status: 'active', lastError },
      { remoteAccountId: 'account-1', remoteConnectionId: 'MX-MBR-connection-1' }
    ),
    'Apple Card authentication is required.'
  );
  assert.equal(
    simplefinConnectionIssue(
      { status: 'active', lastError },
      { remoteAccountId: 'account-2', remoteConnectionId: 'MX-MBR-another-connection' }
    ),
    null
  );
});

test('sync failures and reconnect requirements remain visible after a recent success', () => {
  assert.equal(
    simplefinConnectionIssue({ status: 'active', lastError: 'The provider request failed.' }, { isStale: false }),
    'The provider request failed.'
  );
  assert.equal(
    simplefinConnectionIssue({ status: 'reconnect_required', lastError: 'Access was revoked.' }, { isStale: true }),
    'Reconnect required. Access was revoked.'
  );
});

test('stale connections receive a useful fallback and stored details are sanitized', () => {
  assert.equal(
    simplefinConnectionIssue({ status: 'active', lastSyncSucceededAt: null }, { isStale: true }),
    'This account has not completed a successful SimpleFIN sync yet.'
  );
  assert.equal(storedMessages('failed https://user:password@example.com/accounts')[0].includes('user:password'), false);
});
