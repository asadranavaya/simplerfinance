const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const CURRENT_KEY_VERSION = 1;
const { encryptCustomerValue, decryptCustomerValue } = require('./customerEncryption');

function getKey(version = CURRENT_KEY_VERSION) {
  const variable = version === 1 ? 'SIMPLEFIN_ENCRYPTION_KEY' : `SIMPLEFIN_ENCRYPTION_KEY_V${version}`;
  const encoded = process.env[variable];

  if (!encoded || !/^[a-fA-F0-9]{64}$/.test(encoded)) {
    throw new Error(`${variable} must be configured as exactly 64 hexadecimal characters`);
  }

  return Buffer.from(encoded, 'hex');
}

function encryptAccessUrl(accessUrl, accountId = null, keyVersion = CURRENT_KEY_VERSION) {
  if (typeof accessUrl !== 'string' || !accessUrl.startsWith('https://')) {
    throw new TypeError('SimpleFIN access URL must use HTTPS');
  }

  if (accountId) {
    const { sqlite } = require('../db');
    return {
      encryptedAccessUrl: encryptCustomerValue(sqlite, accountId, 'simplefin-access-url', accessUrl),
      encryptionKeyVersion: keyVersion,
    };
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(keyVersion), iv);
  const ciphertext = Buffer.concat([cipher.update(accessUrl, 'utf8'), cipher.final()]);

  return {
    encryptedAccessUrl: [
      'sfin',
      keyVersion,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.'),
    encryptionKeyVersion: keyVersion,
  };
}

function decryptAccessUrl(envelope, expectedKeyVersion, accountId = null) {
  if (typeof envelope === 'string' && envelope.startsWith('cdata')) {
    if (!accountId) throw new Error('Customer account ID is required to decrypt this SimpleFIN credential');
    const { sqlite } = require('../db');
    return decryptCustomerValue(sqlite, accountId, 'simplefin-access-url', envelope);
  }
  const parts = typeof envelope === 'string' ? envelope.split('.') : [];
  if (parts.length !== 5 || parts[0] !== 'sfin') throw new Error('Invalid SimpleFIN credential envelope');

  const keyVersion = Number(parts[1]);
  if (!Number.isInteger(keyVersion) || keyVersion < 1 || (expectedKeyVersion && keyVersion !== expectedKeyVersion)) {
    throw new Error('Invalid SimpleFIN encryption key version');
  }

  try {
    const decodeCanonical = (value) => {
      if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
      const decoded = Buffer.from(value, 'base64url');
      if (decoded.toString('base64url') !== value) throw new Error('Non-canonical encoding');
      return decoded;
    };
    const iv = decodeCanonical(parts[2]);
    const tag = decodeCanonical(parts[3]);
    const ciphertext = decodeCanonical(parts[4]);
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length || ciphertext.length > 10_000) throw new Error('Invalid envelope size');
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(keyVersion), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    if (error.message.includes('must be configured')) throw error;
    throw new Error('Unable to decrypt SimpleFIN credential');
  }
}

module.exports = { CURRENT_KEY_VERSION, encryptAccessUrl, decryptAccessUrl };
