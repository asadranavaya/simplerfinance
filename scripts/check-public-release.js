const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root })
  .toString('utf8').split('\0').filter(Boolean).filter(file => fs.existsSync(path.join(root, file)));

const forbiddenPaths = tracked.filter(file =>
  /(^|\/)(?:\.env(?:\..*)?|\.secrets|backups|data|dist|node_modules)(?:\/|$)/.test(file)
  || /\.(?:db|db-shm|db-wal|sqlite|sqlite3)$/i.test(file)
).filter(file => file !== '.env.example');

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
];
const suspicious = [];
for (const file of tracked) {
  const filename = path.join(root, file);
  const stats = fs.statSync(filename);
  if (!stats.isFile() || stats.size > 2 * 1024 * 1024) continue;
  const content = fs.readFileSync(filename, 'utf8');
  if (secretPatterns.some(pattern => pattern.test(content))) suspicious.push(file);
}

if (forbiddenPaths.length || suspicious.length) {
  if (forbiddenPaths.length) console.error(`Forbidden tracked runtime files:\n${forbiddenPaths.join('\n')}`);
  if (suspicious.length) console.error(`Files matching secret patterns:\n${suspicious.join('\n')}`);
  process.exit(1);
}

console.log(`Public-release check passed for ${tracked.length} tracked files.`);
console.log('This checks the current snapshot only; run a dedicated secret scanner before publication.');
