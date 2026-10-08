const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Every Node test worker receives a private database. This must be assigned in
// the preload, before any application module can open the production database.
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `budget-app-test-${process.pid}-`));
process.env.NODE_ENV = 'test';
process.env.BUDGET_DB_PATH = path.join(testDirectory, 'budget.db');

process.once('exit', () => {
  try { fs.rmSync(testDirectory, { recursive: true, force: true }); } catch { /* Best-effort cleanup on process exit. */ }
});
