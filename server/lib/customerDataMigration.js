const { decryptCustomerValue, encryptCustomerValue, ensureCustomerKey } = require('./customerEncryption');

const MIGRATION_ID = 'customer-envelope-v1';
const EXPENSE_MIGRATION_ID = 'customer-expense-record-v1';

function isProtected(value) {
  return typeof value === 'string' && /^cdata\d+\./.test(value);
}

function protectColumn(sqlite, { select, update, purpose }) {
  const rows = sqlite.prepare(select).all();
  const statement = sqlite.prepare(update);
  let changed = 0;
  for (const row of rows) {
    if (row.value == null || isProtected(row.value)) continue;
    statement.run(encryptCustomerValue(sqlite, row.account_id, purpose, row.value), row.id);
    changed += 1;
  }
  return changed;
}

function migrateCustomerData(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS customer_encryption_migrations (
      id TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL,
      records_encrypted INTEGER NOT NULL
    )
  `);
  let totalChanged = 0;
  if (!sqlite.prepare('SELECT 1 FROM customer_encryption_migrations WHERE id = ?').get(MIGRATION_ID)) totalChanged += sqlite.transaction(() => {
    for (const { id } of sqlite.prepare('SELECT id FROM accounts').all()) ensureCustomerKey(sqlite, id);
    let changed = 0;
    for (const spec of [
      { select: 'SELECT id, user_id AS account_id, data AS value FROM credit_cards', update: 'UPDATE credit_cards SET data = ? WHERE id = ?', purpose: 'credit_card:data' },
      { select: 'SELECT id, user_id AS account_id, data AS value FROM bank_accounts', update: 'UPDATE bank_accounts SET data = ? WHERE id = ?', purpose: 'bank:data' },
      { select: 'SELECT id, user_id AS account_id, data AS value FROM trading_accounts', update: 'UPDATE trading_accounts SET data = ? WHERE id = ?', purpose: 'trading:data' },
      { select: 'SELECT id, user_id AS account_id, data AS value FROM goals', update: 'UPDATE goals SET data = ? WHERE id = ?', purpose: 'goal:data' },
      { select: 'SELECT e.id, ms.user_id AS account_id, e.data AS value FROM expenses e JOIN monthly_spending ms ON ms.id = e.spending_id', update: 'UPDATE expenses SET data = ? WHERE id = ?', purpose: 'expense:data' },
      { select: 'SELECT id, account_id, metadata AS value FROM notifications', update: 'UPDATE notifications SET metadata = ? WHERE id = ?', purpose: 'notification:metadata' },
      { select: 'SELECT sa.id, sc.user_id AS account_id, sa.raw_data AS value FROM simplefin_accounts sa JOIN simplefin_connections sc ON sc.id = sa.connection_id', update: 'UPDATE simplefin_accounts SET raw_data = ? WHERE id = ?', purpose: 'simplefin-account:raw' },
      { select: 'SELECT st.id, sc.user_id AS account_id, st.raw_data AS value FROM simplefin_transactions st JOIN simplefin_accounts sa ON sa.id = st.simplefin_account_id JOIN simplefin_connections sc ON sc.id = sa.connection_id', update: 'UPDATE simplefin_transactions SET raw_data = ? WHERE id = ?', purpose: 'simplefin-transaction:raw' },
    ]) changed += protectColumn(sqlite, spec);

    const connections = sqlite.prepare('SELECT id, user_id AS account_id, encrypted_access_url AS value FROM simplefin_connections').all();
    const updateCredential = sqlite.prepare('UPDATE simplefin_connections SET encrypted_access_url = ? WHERE id = ?');
    const { decryptAccessUrl } = require('./simplefinCrypto');
    for (const connection of connections) {
      if (isProtected(connection.value)) continue;
      const plaintext = decryptAccessUrl(connection.value, 1);
      updateCredential.run(encryptCustomerValue(sqlite, connection.account_id, 'simplefin-access-url', plaintext), connection.id);
      changed += 1;
    }

    sqlite.prepare('INSERT INTO customer_encryption_migrations (id, completed_at, records_encrypted) VALUES (?, ?, ?)')
      .run(MIGRATION_ID, new Date().toISOString(), changed);
    return changed;
  })();

  if (!sqlite.prepare('SELECT 1 FROM customer_encryption_migrations WHERE id = ?').get(EXPENSE_MIGRATION_ID)) totalChanged += sqlite.transaction(() => {
    const rows = sqlite.prepare(`SELECT e.*, ms.user_id AS account_id FROM expenses e JOIN monthly_spending ms ON ms.id = e.spending_id`).all();
    const update = sqlite.prepare(`UPDATE expenses SET description = '[protected]', amount = 0, category = NULL, date = NULL, data = NULL, encrypted_payload = ? WHERE id = ?`);
    let changed = 0;
    for (const row of rows) {
      if (row.encrypted_payload) continue;
      const data = row.data == null ? null : decryptCustomerValue(sqlite, row.account_id, 'expense:data', row.data);
      const payload = JSON.stringify({ description: row.description, amount: Number(row.amount), category: row.category, date: row.date, data });
      update.run(encryptCustomerValue(sqlite, row.account_id, 'expense:record', payload), row.id);
      changed += 1;
    }
    sqlite.prepare('INSERT INTO customer_encryption_migrations (id, completed_at, records_encrypted) VALUES (?, ?, ?)')
      .run(EXPENSE_MIGRATION_ID, new Date().toISOString(), changed);
    return changed;
  })();
  return totalChanged;
}

module.exports = { migrateCustomerData };
