const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const path = require('path');
const fs = require('fs');
const schema = require('./schema');

const databasePath = process.env.BUDGET_DB_PATH
  ? path.resolve(process.env.BUDGET_DB_PATH)
  : path.join(__dirname, '../../data/budget.db');
const dbDir = path.dirname(databasePath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(databasePath);

// Enable foreign keys and WAL mode for better performance
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('journal_mode = WAL');

const db = drizzle(sqlite, { schema });

// Run migrations (create tables if they don't exist)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    account_id    TEXT,
    created_at    TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    is_active     INTEGER NOT NULL DEFAULT 1,
    email_verified_at TEXT,
    session_version INTEGER NOT NULL DEFAULT 0,
    pending_email TEXT,
    last_email_changed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar TEXT
  );

  CREATE TABLE IF NOT EXISTS account_feature_flags (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    feature_key TEXT NOT NULL,
    enabled_at TEXT NOT NULL,
    enabled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(account_id, feature_key)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS account_feature_flags_account_feature_idx
    ON account_feature_flags(account_id, feature_key);

  CREATE TABLE IF NOT EXISTS customer_encryption_keys (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    wrapped_key TEXT NOT NULL,
    master_key_version INTEGER NOT NULL DEFAULT 1,
    customer_key_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    rotated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS credit_cards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    closed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS bank_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    closed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS trading_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    closed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS monthly_spending (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    card_id TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS split_people (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    encrypted_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS travel_plans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    encrypted_name TEXT NOT NULL,
    encrypted_start_date TEXT NOT NULL,
    encrypted_end_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS travel_plans_user_idx ON travel_plans(user_id);

  CREATE TABLE IF NOT EXISTS travel_preferences (
    user_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    encrypted_excluded_category_ids TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS icon_assets (
    id TEXT PRIMARY KEY, content_hash TEXT NOT NULL UNIQUE, storage_key TEXT NOT NULL UNIQUE,
    byte_size INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','disabled')),
    submitted_by TEXT REFERENCES accounts(id) ON DELETE SET NULL, reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL, reviewed_at TEXT, rejection_reason TEXT
  );
  CREATE TABLE IF NOT EXISTS icon_rules (
    id TEXT PRIMARY KEY, icon_asset_id TEXT NOT NULL REFERENCES icon_assets(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('merchant','financial_product','institution','category')),
    display_name TEXT NOT NULL, normalized_pattern TEXT NOT NULL, match_type TEXT NOT NULL CHECK(match_type IN ('exact','contains')),
    priority INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','disabled')),
    submitted_by TEXT REFERENCES accounts(id) ON DELETE SET NULL, reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    example_text TEXT, created_at TEXT NOT NULL, reviewed_at TEXT, rejection_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS icon_rules_match_idx ON icon_rules(status, entity_type, priority);

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    spending_id TEXT NOT NULL REFERENCES monthly_spending(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT,
    date TEXT,
    data TEXT,
    encrypted_payload TEXT,
    hidden_at TEXT
  );

  CREATE TABLE IF NOT EXISTS financial_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
    monthly_income REAL NOT NULL DEFAULT 0,
    budget_categories TEXT DEFAULT '[]',
    reporting_currency TEXT NOT NULL DEFAULT 'USD'
  );

  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT
  );

  CREATE TABLE IF NOT EXISTS monthly_savings_targets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    monthly_after_tax_income REAL NOT NULL,
    percent_to_save REAL NOT NULL,
    target_amount REAL NOT NULL,
    captured_at TEXT NOT NULL,
    UNIQUE(user_id, year, month)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS monthly_savings_targets_user_period_idx
    ON monthly_savings_targets(user_id, year, month);

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    color TEXT NOT NULL,
    UNIQUE(user_id, name)
  );

  CREATE TABLE IF NOT EXISTS default_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS detected_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    variants TEXT DEFAULT '[]',
    average_amount REAL NOT NULL,
    total_paid REAL NOT NULL,
    first_detected TEXT,
    last_payment TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    occurrences INTEGER NOT NULL,
    consecutive_months INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscription_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    source_subscription_id TEXT NOT NULL REFERENCES detected_subscriptions(id) ON DELETE CASCADE,
    target_subscription_id TEXT NOT NULL REFERENCES detected_subscriptions(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    CHECK(source_subscription_id <> target_subscription_id),
    UNIQUE(user_id, source_subscription_id)
  );
  CREATE INDEX IF NOT EXISTS subscription_links_user_target_idx
    ON subscription_links(user_id, target_subscription_id);

  CREATE TABLE IF NOT EXISTS category_rules (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    normalized_merchant TEXT NOT NULL,
    merchant_label TEXT,
    effective_from TEXT NOT NULL DEFAULT '1970-01-01',
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    category_ids TEXT NOT NULL DEFAULT '[]',
    source_expense_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
    match_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_matched_at TEXT,
    UNIQUE(user_id, normalized_merchant)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS category_rules_user_merchant_idx
    ON category_rules(user_id, normalized_merchant);

  CREATE TABLE IF NOT EXISTS excluded_from_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    original_description TEXT,
    excluded_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mfa_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'mfa',
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trusted_devices (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    device_name TEXT NOT NULL,
    user_agent TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    last_ip TEXT,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_security_events (
    id TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    attempted_emails TEXT NOT NULL DEFAULT '[]',
    ip_address TEXT NOT NULL,
    device_id TEXT,
    device_fingerprint TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    blocked_until TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 1,
    cleared_at TEXT,
    cleared_by INTEGER
  );
  CREATE INDEX IF NOT EXISTS auth_security_events_active_idx
    ON auth_security_events(cleared_at, blocked_until);

  CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    hit_count INTEGER NOT NULL,
    reset_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rate_limit_buckets_reset_idx ON rate_limit_buckets(reset_at);
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    read_at TEXT
  );

  CREATE TABLE IF NOT EXISTS simplefin_notification_digests (
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    digest_date TEXT NOT NULL,
    sync_count INTEGER NOT NULL DEFAULT 0,
    accounts_checked INTEGER NOT NULL DEFAULT 0,
    transactions_updated INTEGER NOT NULL DEFAULT 0,
    expenses_imported INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    warning_keys TEXT NOT NULL DEFAULT '[]',
    failure_count INTEGER NOT NULL DEFAULT 0,
    connection_accounts TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (account_id, digest_date)
  );
  CREATE INDEX IF NOT EXISTS notifications_account_created_idx
    ON notifications(account_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS login_failure_emails (
    bucket_key TEXT NOT NULL REFERENCES rate_limit_buckets(bucket_key) ON DELETE CASCADE,
    email TEXT NOT NULL,
    PRIMARY KEY (bucket_key, email)
  );

  CREATE INDEX IF NOT EXISTS trusted_devices_user_id_idx
    ON trusted_devices(user_id);

  CREATE TABLE IF NOT EXISTS net_worth_snapshots (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    period INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    value REAL NOT NULL,
    is_final INTEGER NOT NULL DEFAULT 0,
    captured_at TEXT NOT NULL,
    reporting_currency TEXT NOT NULL DEFAULT 'USD'
  );

  CREATE TABLE IF NOT EXISTS fx_rate_snapshots (
    id TEXT PRIMARY KEY,
    rate_date TEXT NOT NULL,
    currency TEXT NOT NULL,
    per_eur TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'ECB',
    fetched_at TEXT NOT NULL,
    UNIQUE(rate_date, currency)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS net_worth_snapshots_user_period_idx
    ON net_worth_snapshots(user_id, period);

  CREATE TABLE IF NOT EXISTS simplefin_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    encrypted_access_url TEXT NOT NULL,
    encryption_key_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'syncing', 'reconnect_required', 'revoked', 'disabled')),
    created_at TEXT NOT NULL,
    last_sync_started_at TEXT,
    last_sync_succeeded_at TEXT,
    next_sync_allowed_at TEXT,
    auto_sync_enabled INTEGER NOT NULL DEFAULT 1,
    sync_minute INTEGER NOT NULL DEFAULT 17,
    next_scheduled_sync_at TEXT,
    last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS simplefin_connections_user_id_idx ON simplefin_connections(user_id);

  CREATE TABLE IF NOT EXISTS simplefin_accounts (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES simplefin_connections(id) ON DELETE CASCADE,
    remote_account_id TEXT NOT NULL,
    remote_connection_id TEXT,
    remote_name TEXT NOT NULL,
    institution_name TEXT,
    currency TEXT NOT NULL,
    balance TEXT NOT NULL,
    available_balance TEXT,
    balance_date TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    raw_data TEXT,
    UNIQUE(connection_id, remote_account_id)
  );

  CREATE TABLE IF NOT EXISTS financial_account_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    simplefin_account_id TEXT NOT NULL REFERENCES simplefin_accounts(id) ON DELETE CASCADE,
    local_account_type TEXT CHECK(local_account_type IN ('credit_card', 'bank', 'trading')),
    local_account_id TEXT,
    status TEXT NOT NULL DEFAULT 'deferred' CHECK(status IN ('linked', 'ignored', 'deferred', 'unlinked')),
    balance_source TEXT NOT NULL DEFAULT 'simplefin' CHECK(balance_source IN ('simplefin', 'manual')),
    transaction_sync_enabled INTEGER NOT NULL DEFAULT 0,
    transaction_import_from TEXT,
    transaction_synced_through TEXT,
    created_at TEXT NOT NULL,
    linked_at TEXT,
    unlinked_at TEXT,
    CHECK(status != 'linked' OR (local_account_type IS NOT NULL AND local_account_id IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS financial_account_links_user_id_idx ON financial_account_links(user_id);
  CREATE INDEX IF NOT EXISTS financial_account_links_simplefin_account_idx ON financial_account_links(simplefin_account_id);
  CREATE UNIQUE INDEX IF NOT EXISTS financial_account_links_active_remote_idx
    ON financial_account_links(simplefin_account_id) WHERE status = 'linked';
  CREATE UNIQUE INDEX IF NOT EXISTS financial_account_links_active_local_idx
    ON financial_account_links(user_id, local_account_type, local_account_id) WHERE status = 'linked';

  CREATE TABLE IF NOT EXISTS simplefin_transactions (
    id TEXT PRIMARY KEY,
    simplefin_account_id TEXT NOT NULL REFERENCES simplefin_accounts(id) ON DELETE CASCADE,
    remote_transaction_id TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    transacted_at TEXT,
    amount TEXT NOT NULL,
    description TEXT NOT NULL,
    pending INTEGER NOT NULL DEFAULT 0,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    raw_data TEXT,
    expense_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
    classification TEXT,
    classification_source TEXT,
    classification_reason TEXT,
    UNIQUE(simplefin_account_id, remote_transaction_id)
  );

  CREATE TABLE IF NOT EXISTS simplefin_sync_runs (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES simplefin_connections(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'partial', 'failed')),
    trigger TEXT NOT NULL DEFAULT 'manual',
    accounts_received INTEGER NOT NULL DEFAULT 0,
    transactions_inserted INTEGER NOT NULL DEFAULT 0,
    transactions_updated INTEGER NOT NULL DEFAULT 0,
    warnings TEXT,
    error_code TEXT,
    error_summary TEXT,
    expenses_materialized INTEGER NOT NULL DEFAULT 0,
    duplicate_candidates INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS simplefin_sync_runs_connection_idx ON simplefin_sync_runs(connection_id);

  CREATE TABLE IF NOT EXISTS simplefin_duplicate_candidates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    simplefin_transaction_id TEXT NOT NULL UNIQUE REFERENCES simplefin_transactions(id) ON DELETE CASCADE,
    possible_expense_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'keep_manual', 'import_separately')),
    score REAL NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS simplefin_duplicate_candidates_user_idx
    ON simplefin_duplicate_candidates(user_id, status);
`);

// Categories were originally global, allowing one customer to see and mutate
// another customer's categories. Migrate only categories demonstrably used by
// each account. Unowned legacy rows remain quarantined in a non-routed archive
// table so the migration is recoverable without continuing the data leak.
const categoryColumns = sqlite.prepare(`PRAGMA table_info(categories)`).all();
if (categoryColumns.length && !categoryColumns.some((column) => column.name === 'user_id')) {
  sqlite.transaction(() => {
    const legacyCategories = sqlite.prepare(`SELECT id, name, color FROM categories`).all();
    const colorsByName = new Map(legacyCategories.map(row => [String(row.name).trim().toLocaleLowerCase(), row.color]));
    const ownedNames = new Map();
    const remember = (userId, value) => {
      const name = typeof value === 'string' ? value.trim() : '';
      if (!userId || !name) return;
      const byName = ownedNames.get(userId) || new Map();
      if (!byName.has(name.toLocaleLowerCase())) byName.set(name.toLocaleLowerCase(), name);
      ownedNames.set(userId, byName);
    };
    for (const row of sqlite.prepare(`
      SELECT monthly_spending.user_id, expenses.category, expenses.data
      FROM expenses JOIN monthly_spending ON monthly_spending.id = expenses.spending_id
    `).all()) {
      remember(row.user_id, row.category);
      try {
        const data = JSON.parse(row.data || '{}');
        remember(row.user_id, data.mainCategory);
        for (const name of Array.isArray(data.categories) ? data.categories : []) remember(row.user_id, name);
      } catch (_) { /* Preserve valid relational category data even if metadata is malformed. */ }
    }
    for (const row of sqlite.prepare(`SELECT user_id, budget_categories FROM financial_profiles`).all()) {
      try {
        for (const entry of JSON.parse(row.budget_categories || '[]')) {
          remember(row.user_id, typeof entry === 'string' ? entry : entry?.name);
        }
      } catch (_) { /* Ignore malformed legacy profile metadata. */ }
    }

    sqlite.exec(`
      ALTER TABLE categories RENAME TO categories_legacy_global;
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name TEXT NOT NULL COLLATE NOCASE,
        color TEXT NOT NULL,
        UNIQUE(user_id, name)
      );
      CREATE UNIQUE INDEX categories_user_name_idx ON categories(user_id, name);
    `);
    const insert = sqlite.prepare(`INSERT OR IGNORE INTO categories (user_id, name, color) VALUES (?, ?, ?)`);
    const fallbackColors = ['#28a745','#007bff','#dc3545','#ffc107','#17a2b8','#6f42c1','#fd7e14','#6c757d'];
    let colorIndex = 0;
    for (const [userId, names] of ownedNames) {
      for (const [normalized, name] of names) {
        insert.run(userId, name, colorsByName.get(normalized) || fallbackColors[colorIndex++ % fallbackColors.length]);
      }
    }
  })();
}

const categoryRuleForeignKeys = sqlite.prepare(`PRAGMA foreign_key_list(category_rules)`).all();
if (categoryRuleForeignKeys.some((foreignKey) => foreignKey.table === 'categories_legacy_global')) {
  sqlite.exec(`
    DROP TABLE category_rules;
    CREATE TABLE category_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      normalized_merchant TEXT NOT NULL,
      merchant_label TEXT,
      effective_from TEXT NOT NULL DEFAULT '1970-01-01',
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      source_expense_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
      match_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_matched_at TEXT,
      UNIQUE(user_id, normalized_merchant)
    );
    CREATE UNIQUE INDEX category_rules_user_merchant_idx ON category_rules(user_id, normalized_merchant);
  `);
}

// Add missing columns to financial_profiles (migration)
const addColSql = [
  'ALTER TABLE financial_profiles ADD COLUMN yearly_income REAL NOT NULL DEFAULT 0',
  'ALTER TABLE financial_profiles ADD COLUMN percent_to_save REAL NOT NULL DEFAULT 0',
  'ALTER TABLE financial_profiles ADD COLUMN percent_to_contribute REAL NOT NULL DEFAULT 0',
  'ALTER TABLE financial_profiles ADD COLUMN monthly_saving_target REAL NOT NULL DEFAULT 0',
  'ALTER TABLE financial_profiles ADD COLUMN monthly_spend_limit REAL NOT NULL DEFAULT 0',
  'ALTER TABLE financial_profiles ADD COLUMN yearly_income_after_tax REAL NOT NULL DEFAULT 0',
  `ALTER TABLE financial_profiles ADD COLUMN reporting_currency TEXT NOT NULL DEFAULT 'USD'`,
];
for (const sql of addColSql) {
  try { sqlite.exec(sql); } catch (_) {} // column already exists — safe to ignore
}

// Add mfa_enabled column to users if it doesn't exist (migration for existing databases)
try {
  sqlite.exec(`ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0`);
} catch (e) {
  // Column already exists — safe to ignore
}

// Admin and account activation fields (existing users remain active members).
for (const sql of [
  `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`,
  `ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`,
]) {
  try { sqlite.exec(sql); } catch (_) {} // column already exists
}

try { sqlite.exec(`ALTER TABLE financial_account_links ADD COLUMN transaction_synced_through TEXT`); } catch (_) {}
try { sqlite.exec(`ALTER TABLE expenses ADD COLUMN encrypted_payload TEXT`); } catch (_) {}
try { sqlite.exec(`ALTER TABLE expenses ADD COLUMN hidden_at TEXT`); } catch (_) {}
try { sqlite.exec(`ALTER TABLE category_rules ADD COLUMN merchant_label TEXT`); } catch (_) {}
try { sqlite.exec(`ALTER TABLE category_rules ADD COLUMN effective_from TEXT NOT NULL DEFAULT '1970-01-01'`); } catch (_) {}
try { sqlite.exec(`ALTER TABLE category_rules ADD COLUMN category_ids TEXT NOT NULL DEFAULT '[]'`); } catch (_) {}
try { sqlite.exec(`ALTER TABLE simplefin_notification_digests ADD COLUMN connection_accounts TEXT NOT NULL DEFAULT '{}'`); } catch (_) {}
try { sqlite.exec(`ALTER TABLE simplefin_notification_digests ADD COLUMN warning_keys TEXT NOT NULL DEFAULT '[]'`); } catch (_) {}

for (const table of ['credit_cards', 'bank_accounts', 'trading_accounts']) {
  try { sqlite.exec(`ALTER TABLE ${table} ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`); } catch (_) {}
  try { sqlite.exec(`ALTER TABLE ${table} ADD COLUMN include_in_net_worth INTEGER NOT NULL DEFAULT 1`); } catch (_) {}
  try { sqlite.exec(`ALTER TABLE ${table} ADD COLUMN closed_at TEXT`); } catch (_) {}
}

try { sqlite.exec(`ALTER TABLE users ADD COLUMN email_verified_at TEXT`); } catch (_) {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN pending_email TEXT`); } catch (_) {}
try { sqlite.exec(`ALTER TABLE users ADD COLUMN last_email_changed_at TEXT`); } catch (_) {}
try { sqlite.exec(`ALTER TABLE mfa_tokens ADD COLUMN purpose TEXT NOT NULL DEFAULT 'mfa'`); } catch (_) {}
sqlite.exec(`UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL AND is_active = 1`);

try { sqlite.exec(`ALTER TABLE net_worth_snapshots ADD COLUMN reporting_currency TEXT NOT NULL DEFAULT 'USD'`); } catch (_) {}

for (const sql of [
  `ALTER TABLE simplefin_connections ADD COLUMN auto_sync_enabled INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE simplefin_connections ADD COLUMN sync_minute INTEGER NOT NULL DEFAULT 17`,
  `ALTER TABLE simplefin_connections ADD COLUMN next_scheduled_sync_at TEXT`,
]) {
  try { sqlite.exec(sql); } catch (_) {} // column already exists
}

for (const sql of [
  `ALTER TABLE simplefin_sync_runs ADD COLUMN expenses_materialized INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE simplefin_sync_runs ADD COLUMN duplicate_candidates INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE simplefin_sync_runs ADD COLUMN trigger TEXT NOT NULL DEFAULT 'manual'`,
]) {
  try { sqlite.exec(sql); } catch (_) {} // column already exists
}

for (const sql of [
  `ALTER TABLE simplefin_transactions ADD COLUMN classification TEXT`,
  `ALTER TABLE simplefin_transactions ADD COLUMN classification_source TEXT`,
  `ALTER TABLE simplefin_transactions ADD COLUMN classification_reason TEXT`,
  `ALTER TABLE simplefin_transactions ADD COLUMN transacted_at TEXT`,
]) {
  try { sqlite.exec(sql); } catch (_) {} // column already exists
}

// Seed the bundled, checksummed v1 icon library after the icon tables exist.
// Equivalent deployment rules are preserved and take precedence.
require('../lib/sharedIconLibrary').seedSharedIconLibrary(sqlite);

module.exports = { db, sqlite };
