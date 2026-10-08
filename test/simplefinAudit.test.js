const test = require('node:test');
const assert = require('node:assert/strict');
const { publicSyncRun, safeWarnings } = require('../server/lib/simplefinAudit');

test('sync audit exposes only its explicit sanitized allowlist', () => {
  const result = publicSyncRun({
    id: 'run-1', connectionId: 'connection-1', startedAt: '2026-08-07T00:00:00.000Z',
    completedAt: null, status: 'running', trigger: 'automatic', accountsReceived: 2,
    encryptedAccessUrl: 'secret', rawData: '{"token":"secret"}',
  });
  assert.equal(result.trigger, 'automatic');
  assert.equal(result.accountsReceived, 2);
  assert.equal('encryptedAccessUrl' in result, false);
  assert.equal('rawData' in result, false);
});

test('sync audit redacts credentials from warnings and errors', () => {
  const warnings = safeWarnings(JSON.stringify([{ code: 'remote', message: 'failed https://user:pass@example.com/accounts' }]));
  assert.equal(warnings[0].message.includes('user:pass'), false);
  const result = publicSyncRun({
    id: 'run-2', connectionId: 'connection-1', status: 'failed', trigger: 'manual',
    errorCode: 'request_failed', errorSummary: 'token=test-fixture',
  });
  assert.equal(result.error.message.includes('test-fixture'), false);
});
