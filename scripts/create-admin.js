#!/usr/bin/env node
const path = require('path');
const { loadEnvFile } = require('./lib/env-file');
loadEnvFile(path.join(__dirname, '../.env'));
const { provisionAccount } = require('./lib/provision-account');

const [, , email, password, name = 'Administrator'] = process.argv;
if (!email || !password) {
  console.error('Usage: npm run create-admin -- <email> <password> [name]');
  process.exit(1);
}

provisionAccount({ email, password, name, role: 'admin' }, { updateExisting: true })
  .then(result => console.log(`Administrator ${result.created ? 'created' : 'updated'}: ${result.email}`))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
