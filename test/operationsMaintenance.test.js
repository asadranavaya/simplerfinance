const test = require('node:test');
const assert = require('node:assert/strict');
const { BACKUP_DIR } = require('../server/lib/operationsMaintenance');

test('backup target is a dedicated directory outside runtime database files', () => {
  assert.match(BACKUP_DIR, /\/backups$/);
  assert.equal(BACKUP_DIR.includes('/data/'), false);
});
