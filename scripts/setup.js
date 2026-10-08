#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const { loadEnvFile, renderEnv } = require('./lib/env-file');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const rl = readline.createInterface({ input: stdin, output: stdout });

async function ask(label, fallback = '') {
  const suffix = fallback ? ` [${fallback}]` : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || fallback;
}

async function yesNo(label, fallback = true) {
  const answer = (await rl.question(`${label} ${fallback ? '[Y/n]' : '[y/N]'}: `)).trim().toLowerCase();
  if (!answer) return fallback;
  return answer === 'y' || answer === 'yes';
}

async function secret(label) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return ask(label);
  stdout.write(`${label}: `);
  stdin.setRawMode(true);
  stdin.resume();
  let value = '';
  return new Promise((resolve, reject) => {
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdout.write('\n');
      resolve(value);
    };
    const onData = buffer => {
      const text = buffer.toString('utf8');
      for (const character of text) {
        if (character === '\u0003') {
          stdin.off('data', onData); stdin.setRawMode(false); stdout.write('\n'); reject(new Error('Setup cancelled.')); return;
        }
        if (character === '\r' || character === '\n') { finish(); return; }
        if (character === '\u007f' || character === '\b') {
          if (value) { value = value.slice(0, -1); stdout.write('\b \b'); }
          continue;
        }
        if (character >= ' ') { value += character; stdout.write('*'); }
      }
    };
    stdin.on('data', onData);
  });
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.`);
}

async function identity(role) {
  const email = await ask(`${role === 'admin' ? 'Administrator' : 'User'} email`);
  const name = await ask('Display name', role === 'admin' ? 'Administrator' : 'Budget User');
  const password = await secret('Password (12–128 characters)');
  const confirmation = await secret('Confirm password');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  const { provisionAccount } = require('./lib/provision-account');
  const result = await provisionAccount({ email, password, name, role }, { updateExisting: role === 'admin' });
  stdout.write(`${role === 'admin' ? 'Administrator' : 'User'} ${result.created ? 'created' : 'updated'}: ${result.email}\n`);
}

async function main() {
  stdout.write('\nSimplerFinance guided setup\n=======================\n');
  stdout.write('This creates local configuration and accounts. It never uploads configuration or financial data.\n\n');

  const modeAnswer = (await ask('Deployment mode: local or pm2', 'local')).toLowerCase();
  let selectedEmailMode = 'none';
  if (!['local', 'pm2'].includes(modeAnswer)) throw new Error('Choose local or pm2.');

  if (await yesNo('Install exact root and renderer dependencies now?', true)) {
    run('npm', ['ci']);
    run('npm', ['ci', '--prefix', 'renderer']);
  } else if (!fs.existsSync(path.join(root, 'node_modules'))) {
    throw new Error('Dependencies are required for local and PM2 setup. Rerun setup and install them.');
  }

  if (fs.existsSync(envPath)) {
    if (!await yesNo('An .env file already exists. Keep it unchanged?', true)) throw new Error('Move or back up the existing .env before generating a replacement.');
    loadEnvFile(envPath);
    selectedEmailMode = process.env.SMTP_HOST ? 'smtp' : 'none';
  } else {
    const emailMode = (await ask('Email mode: smtp or none', 'none')).toLowerCase();
    if (!['smtp', 'none'].includes(emailMode)) throw new Error('Choose smtp or none.');
    selectedEmailMode = emailMode;

    const values = {
      NODE_ENV: modeAnswer === 'local' ? 'development' : 'production',
      PORT: '3001',
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      ALLOW_REGISTRATION: 'false',
      BUDGET_DB_PATH: './data/budget.db',
      SERVICE_LOG_DB_PATH: './data/service-logs.db',
      SMTP_HOST: '', SMTP_PORT: '', SMTP_SECURE: 'false', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '',
      SIMPLEFIN_ENCRYPTION_KEY: '',
      CUSTOMER_DATA_MASTER_KEY: crypto.randomBytes(32).toString('hex'),
      MAXMIND_CITY_DB_PATH: '',
    };

    if (emailMode === 'smtp') {
      values.SMTP_HOST = await ask('SMTP host');
      values.SMTP_PORT = await ask('SMTP port', '587');
      values.SMTP_SECURE = String(await yesNo('Use implicit SMTP TLS?', values.SMTP_PORT === '465'));
      values.SMTP_USER = await ask('SMTP username (blank if none)');
      values.SMTP_PASS = values.SMTP_USER ? await secret('SMTP password') : '';
      values.SMTP_FROM = await ask('From address', 'SimplerFinance <no-reply@example.com>');
    }

    if (await yesNo('Enable optional SimpleFIN support?', false)) values.SIMPLEFIN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(envPath, renderEnv(values), { mode: 0o600, flag: 'wx' });
    loadEnvFile(envPath);
    stdout.write('Created private .env with generated independent encryption/session keys.\n');
  }

  if (await yesNo('Create or update an administrator now?', true)) await identity('admin');
  if (await yesNo('Create a normal finance user now?', true)) await identity('user');

  if (await yesNo('Build the production frontend now?', modeAnswer !== 'local')) run('npm', ['run', 'build']);
  const verifySmtp = selectedEmailMode === 'smtp' && await yesNo('Verify the SMTP connection now (no message will be sent)?', true);
  run(process.execPath, ['scripts/doctor.js', ...(verifySmtp ? ['--smtp'] : [])]);

  stdout.write('\nSetup complete.\n');
  if (modeAnswer === 'local') stdout.write('Start development: npm run dev\n');
  if (modeAnswer === 'pm2') stdout.write('Install/start PM2: bash scripts/install-pm2.sh\n');
}

main().catch(error => { console.error(`\nSetup failed: ${error.message}`); process.exitCode = 1; })
  .finally(() => rl.close());
