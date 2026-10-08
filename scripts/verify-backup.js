#!/usr/bin/env node
const os = require('os');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { loadEnvFile } = require('./lib/env-file');
loadEnvFile(path.join(__dirname, '../.env'));
const { sqlite } = require('../server/db');

const destination = path.join(os.tmpdir(), `budget-backup-verify-${process.pid}.db`);
(async () => {
  await sqlite.backup(destination);
  const restored = new Database(destination, { readonly: true });
  const result = restored.pragma('integrity_check', { simple: true });
  restored.close();
  if (result !== 'ok') throw new Error(`Backup integrity check failed: ${result}`);
  console.log('Backup restore verification passed.');
})().catch(error => {
  console.error(error.message); process.exitCode = 1;
}).finally(() => {
  if (fs.existsSync(destination)) fs.unlinkSync(destination);
});
