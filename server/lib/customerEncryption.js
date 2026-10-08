const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MASTER_KEY_VERSION = 1;
const CUSTOMER_KEY_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const SECRET_DIR = path.join(__dirname, '../../.secrets');
const MASTER_KEY_FILE = path.join(SECRET_DIR, 'customer-data-master-key');

function decodeKey(value, label) {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.trim())) {
    throw new Error(`${label} must contain exactly 64 hexadecimal characters`);
  }
  return Buffer.from(value.trim(), 'hex');
}

function masterKey() {
  if (process.env.CUSTOMER_DATA_MASTER_KEY) {
    return decodeKey(process.env.CUSTOMER_DATA_MASTER_KEY, 'CUSTOMER_DATA_MASTER_KEY');
  }
  fs.mkdirSync(SECRET_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(MASTER_KEY_FILE)) {
    fs.writeFileSync(MASTER_KEY_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  }
  fs.chmodSync(MASTER_KEY_FILE, 0o600);
  return decodeKey(fs.readFileSync(MASTER_KEY_FILE, 'utf8'), MASTER_KEY_FILE);
}

function seal(key, prefix, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [prefix, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function open(key, envelope, prefix, aad) {
  const parts = typeof envelope === 'string' ? envelope.split('.') : [];
  if (parts.length !== 4 || parts[0] !== prefix) throw new Error('Invalid encrypted data envelope');
  try {
    const decodeCanonical = (value) => {
      if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
      const decoded = Buffer.from(value, 'base64url');
      if (decoded.toString('base64url') !== value) throw new Error('Non-canonical encoding');
      return decoded;
    };
    const iv = decodeCanonical(parts[1]);
    const tag = decodeCanonical(parts[2]);
    const ciphertext = decodeCanonical(parts[3]);
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw new Error('Invalid envelope');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new Error('Unable to decrypt protected customer data');
  }
}

function ensureCustomerKey(sqlite, accountId) {
  if (typeof accountId !== 'string' || !accountId) throw new Error('A customer account ID is required for encryption');
  let record = sqlite.prepare('SELECT * FROM customer_encryption_keys WHERE account_id = ?').get(accountId);
  if (record) return record;
  const createdAt = new Date().toISOString();
  const rawKey = crypto.randomBytes(32);
  const aad = `customer-key:${accountId}:${MASTER_KEY_VERSION}:${CUSTOMER_KEY_VERSION}`;
  const wrappedKey = seal(masterKey(), `ckey${MASTER_KEY_VERSION}`, rawKey, aad);
  sqlite.prepare(`
    INSERT OR IGNORE INTO customer_encryption_keys
      (account_id, wrapped_key, master_key_version, customer_key_version, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(accountId, wrappedKey, MASTER_KEY_VERSION, CUSTOMER_KEY_VERSION, createdAt);
  rawKey.fill(0);
  record = sqlite.prepare('SELECT * FROM customer_encryption_keys WHERE account_id = ?').get(accountId);
  return record;
}

function customerKey(sqlite, accountId) {
  const record = ensureCustomerKey(sqlite, accountId);
  const aad = `customer-key:${accountId}:${record.master_key_version}:${record.customer_key_version}`;
  return open(masterKey(), record.wrapped_key, `ckey${record.master_key_version}`, aad);
}

function encryptCustomerValue(sqlite, accountId, purpose, value) {
  if (value == null) return value;
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (/^cdata\d+\./.test(serialized)) return serialized;
  const key = customerKey(sqlite, accountId);
  try {
    return seal(key, `cdata${CUSTOMER_KEY_VERSION}`, Buffer.from(serialized, 'utf8'), `customer-data:${accountId}:${purpose}`);
  } finally {
    key.fill(0);
  }
}

function decryptCustomerValue(sqlite, accountId, purpose, value) {
  if (value == null || typeof value !== 'string' || !value.startsWith('cdata')) return value;
  const key = customerKey(sqlite, accountId);
  try {
    return open(key, value, `cdata${CUSTOMER_KEY_VERSION}`, `customer-data:${accountId}:${purpose}`).toString('utf8');
  } finally {
    key.fill(0);
  }
}

function customerBlindIndex(sqlite, accountId, purpose, value) {
  const key = customerKey(sqlite, accountId);
  try {
    return crypto.createHmac('sha256', key).update(`${purpose}\0${String(value).trim().toLowerCase()}`).digest('hex');
  } finally {
    key.fill(0);
  }
}

module.exports = {
  MASTER_KEY_FILE,
  customerBlindIndex,
  decryptCustomerValue,
  encryptCustomerValue,
  ensureCustomerKey,
};
