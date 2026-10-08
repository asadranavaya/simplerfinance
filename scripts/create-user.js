#!/usr/bin/env node
const path = require('path');
const { loadEnvFile } = require('./lib/env-file');
loadEnvFile(path.join(__dirname, '../.env'));
const { provisionAccount } = require('./lib/provision-account');

const [, , email, password, name = 'Budget User'] = process.argv;
if (!email || !password) {
  console.error('Usage: npm run create-user -- <email> <password> [name]');
  console.error('The created local user is active and email-verified. Use registration for proof-of-email onboarding.');
  process.exit(1);
}

provisionAccount({ email, password, name, role: 'user' })
  .then(result => console.log(`User created: ${result.email} (${result.accountId})`))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
