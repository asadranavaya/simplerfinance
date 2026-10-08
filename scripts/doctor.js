#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadEnvFile } = require('./lib/env-file');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const env = loadEnvFile(envPath);
let failures = 0;
let warnings = 0;
const report = (level, message) => {
  if (level === 'FAIL') failures += 1;
  if (level === 'WARN') warnings += 1;
  console.log(`${level.padEnd(4)} ${message}`);
};

const nodeMajor = Number(process.versions.node.split('.')[0]);
report(nodeMajor >= 22 ? 'PASS' : nodeMajor >= 20 ? 'WARN' : 'FAIL', `Node.js ${process.versions.node} (22+ recommended)`);
report(fs.existsSync(envPath) ? 'PASS' : 'FAIL', '.env exists');
report(fs.existsSync(path.join(root, 'node_modules')) ? 'PASS' : 'FAIL', 'root dependencies installed');
report(fs.existsSync(path.join(root, 'renderer/node_modules')) ? 'PASS' : 'FAIL', 'renderer dependencies installed');

const production = (env.NODE_ENV || process.env.NODE_ENV) === 'production';
const jwt = env.JWT_SECRET || process.env.JWT_SECRET || '';
report(jwt.length >= 32 ? 'PASS' : production ? 'FAIL' : 'WARN', 'JWT_SECRET has at least 32 characters');
const master = env.CUSTOMER_DATA_MASTER_KEY || process.env.CUSTOMER_DATA_MASTER_KEY || '';
report(!master ? 'WARN' : /^[a-f0-9]{64}$/i.test(master) ? 'PASS' : 'FAIL', master ? 'customer master key is a 32-byte hex value' : 'customer master key will be generated in .secrets; back up that file');
const simplefin = env.SIMPLEFIN_ENCRYPTION_KEY || process.env.SIMPLEFIN_ENCRYPTION_KEY || '';
report(!simplefin ? 'PASS' : /^[a-f0-9]{64}$/i.test(simplefin) ? 'PASS' : 'FAIL', simplefin ? 'SimpleFIN key is valid' : 'SimpleFIN disabled (optional)');

const smtpHost = env.SMTP_HOST || process.env.SMTP_HOST || '';
report(smtpHost ? 'PASS' : 'WARN', smtpHost ? `SMTP configured at ${smtpHost}` : 'SMTP unavailable; registration, recovery, MFA, and email changes cannot send codes');
if (smtpHost) {
  const smtpPort = Number(env.SMTP_PORT || process.env.SMTP_PORT);
  report(Number.isInteger(smtpPort) && smtpPort > 0 && smtpPort <= 65535 ? 'PASS' : 'FAIL', 'SMTP port is valid');
}

for (const relative of ['data', '.secrets']) {
  const directory = path.join(root, relative);
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    report('PASS', `${relative}/ is readable and writable`);
  } catch (error) { report('FAIL', `${relative}/ is unavailable: ${error.message}`); }
}

report(fs.existsSync(path.join(root, 'dist/index.html')) ? 'PASS' : production ? 'FAIL' : 'WARN', 'production frontend is built');
const publicCheck = spawnSync(process.execPath, ['scripts/check-public-release.js'], { cwd: root, encoding: 'utf8' });
report(publicCheck.status === 0 ? 'PASS' : 'FAIL', 'public-release file check');

async function networkChecks() {
  if (process.argv.includes('--smtp')) {
    if (!smtpHost) report('FAIL', 'SMTP verification requested but SMTP is not configured');
    else {
      try {
        const nodemailer = require('nodemailer');
        const smtpUser = env.SMTP_USER || process.env.SMTP_USER || '';
        const transport = nodemailer.createTransport({
          host: smtpHost,
          port: Number(env.SMTP_PORT || process.env.SMTP_PORT || 587),
          secure: (env.SMTP_SECURE || process.env.SMTP_SECURE) === 'true',
          auth: smtpUser ? { user: smtpUser, pass: env.SMTP_PASS || process.env.SMTP_PASS || '' } : undefined,
        });
        await transport.verify();
        report('PASS', 'SMTP connection and authentication verified (no message sent)');
        transport.close();
      } catch (error) { report('FAIL', `SMTP verification failed: ${error.message}`); }
    }
  }
  if (process.argv.includes('--live')) {
    const port = env.PORT || process.env.PORT || '3001';
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      report(response.ok ? 'PASS' : 'FAIL', `live health endpoint returned HTTP ${response.status}`);
    } catch (error) { report('FAIL', `live health endpoint unavailable: ${error.message}`); }
  }
  finish();
}

networkChecks();

function finish() {
  console.log(`\nDoctor finished with ${failures} failure(s) and ${warnings} warning(s).`);
  if (failures) process.exitCode = 1;
}
