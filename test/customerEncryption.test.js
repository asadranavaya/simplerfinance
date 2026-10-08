const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  customerBlindIndex,
  decryptCustomerValue,
  encryptCustomerValue,
  ensureCustomerKey,
} = require('../server/lib/customerEncryption');
const { protectExpenseRecord, revealExpenseData } = require('../server/lib/customerDataFields');

function keyDatabase() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE customer_encryption_keys (
      account_id TEXT PRIMARY KEY,
      wrapped_key TEXT NOT NULL,
      master_key_version INTEGER NOT NULL,
      customer_key_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      rotated_at TEXT
    )
  `);
  return sqlite;
}

test('each customer receives a distinct wrapped data-encryption key', () => {
  const sqlite = keyDatabase();
  const first = ensureCustomerKey(sqlite, 'customer-a');
  const second = ensureCustomerKey(sqlite, 'customer-b');
  assert.notEqual(first.wrapped_key, second.wrapped_key);

  const firstCiphertext = encryptCustomerValue(sqlite, 'customer-a', 'profile', 'sensitive value');
  const secondCiphertext = encryptCustomerValue(sqlite, 'customer-b', 'profile', 'sensitive value');
  assert.notEqual(firstCiphertext, secondCiphertext);
  assert.equal(decryptCustomerValue(sqlite, 'customer-a', 'profile', firstCiphertext), 'sensitive value');
  assert.throws(() => decryptCustomerValue(sqlite, 'customer-b', 'profile', firstCiphertext), /Unable to decrypt/);
  sqlite.close();
});

test('customer encryption authenticates purpose and ciphertext', () => {
  const sqlite = keyDatabase();
  const ciphertext = encryptCustomerValue(sqlite, 'customer-a', 'expense:data', '{"private":true}');
  assert.throws(() => decryptCustomerValue(sqlite, 'customer-a', 'goal:data', ciphertext), /Unable to decrypt/);
  const parts = ciphertext.split('.');
  parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => decryptCustomerValue(sqlite, 'customer-a', 'expense:data', parts.join('.')), /Unable to decrypt/);
  sqlite.close();
});

test('blind indexes are stable within one customer and isolated between customers', () => {
  const sqlite = keyDatabase();
  assert.equal(customerBlindIndex(sqlite, 'customer-a', 'email', ' USER@example.com '), customerBlindIndex(sqlite, 'customer-a', 'email', 'user@example.com'));
  assert.notEqual(customerBlindIndex(sqlite, 'customer-a', 'email', 'user@example.com'), customerBlindIndex(sqlite, 'customer-b', 'email', 'user@example.com'));
  sqlite.close();
});

test('encrypted expense records expose metadata without relying on the legacy data column', () => {
  const sqlite = keyDatabase();
  const accountA = 'customer-a';
  sqlite.exec('CREATE TABLE monthly_spending (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)');
  sqlite.prepare('INSERT INTO monthly_spending (id, user_id) VALUES (?, ?)').run('month-1', accountA);
  const protectedExpense = protectExpenseRecord(sqlite, accountA, {
    spendingId: 'month-1',
    description: 'Alaska Airlines',
    amount: 250,
    category: 'Travel',
    date: '2026-08-11',
    data: JSON.stringify({ categories: ['Travel', 'Air Travel'], mainCategory: 'Travel' }),
  });
  assert.equal(protectedExpense.data, null);
  assert.deepEqual(JSON.parse(revealExpenseData(sqlite, protectedExpense)), {
    categories: ['Travel', 'Air Travel'],
    mainCategory: 'Travel',
  });
  sqlite.close();
});
