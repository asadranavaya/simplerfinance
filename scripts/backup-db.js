#!/usr/bin/env node
const path = require('path');
const { loadEnvFile } = require('./lib/env-file');
loadEnvFile(path.join(__dirname, '../.env'));
const { createDatabaseBackup, pruneBackups } = require('../server/lib/operationsMaintenance');
createDatabaseBackup().then((destination) => {
  pruneBackups();
  console.log(`SQLite backup created: ${destination}`);
}).catch((error) => {
  console.error(`Backup failed: ${error.message}`);
  process.exitCode = 1;
});
