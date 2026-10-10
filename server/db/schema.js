const { sqliteTable, text, integer, real, uniqueIndex, index } = require('drizzle-orm/sqlite-core');

const users = sqliteTable('users', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  email:        text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  accountId:    text('account_id'),
  createdAt:    text('created_at').notNull(),
  mfaEnabled:   integer('mfa_enabled', { mode: 'boolean' }).notNull().default(false),
  role:         text('role').notNull().default('user'),
  isActive:     integer('is_active', { mode: 'boolean' }).notNull().default(true),
  emailVerifiedAt: text('email_verified_at'),
  sessionVersion: integer('session_version').notNull().default(0),
  pendingEmail: text('pending_email'),
  lastEmailChangedAt: text('last_email_changed_at'),
});

const accounts = sqliteTable('accounts', {
  id:     text('id').primaryKey(),
  name:   text('name').notNull(),
  avatar: text('avatar'),
});

const accountFeatureFlags = sqliteTable('account_feature_flags', {
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  featureKey: text('feature_key').notNull(),
  enabledAt: text('enabled_at').notNull(),
  enabledBy: integer('enabled_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => [uniqueIndex('account_feature_flags_account_feature_idx').on(table.accountId, table.featureKey)]);

const customerEncryptionKeys = sqliteTable('customer_encryption_keys', {
  accountId:          text('account_id').primaryKey().references(() => accounts.id, { onDelete: 'cascade' }),
  wrappedKey:         text('wrapped_key').notNull(),
  masterKeyVersion:   integer('master_key_version').notNull().default(1),
  customerKeyVersion: integer('customer_key_version').notNull().default(1),
  createdAt:          text('created_at').notNull(),
  rotatedAt:          text('rotated_at'),
});

const creditCards = sqliteTable('credit_cards', {
  id:     text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name:   text('name').notNull(),
  data:   text('data'), // JSON blob for any extra card fields
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  includeInNetWorth: integer('include_in_net_worth', { mode: 'boolean' }).notNull().default(true),
  closedAt: text('closed_at'),
});

const bankAccounts = sqliteTable('bank_accounts', {
  id:     text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name:   text('name').notNull(),
  data:   text('data'), // JSON blob for extra fields
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  includeInNetWorth: integer('include_in_net_worth', { mode: 'boolean' }).notNull().default(true),
  closedAt: text('closed_at'),
});

const tradingAccounts = sqliteTable('trading_accounts', {
  id:     text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name:   text('name').notNull(),
  data:   text('data'), // JSON blob for extra fields
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  includeInNetWorth: integer('include_in_net_worth', { mode: 'boolean' }).notNull().default(true),
  closedAt: text('closed_at'),
});

const monthlySpending = sqliteTable('monthly_spending', {
  id:     text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  year:   integer('year').notNull(),
  month:  integer('month').notNull(),
  cardId: text('card_id').notNull(),
});

const splitPeople = sqliteTable('split_people', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  encryptedName: text('encrypted_name').notNull(),
  createdAt: text('created_at').notNull(),
});

const travelPlans = sqliteTable('travel_plans', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  encryptedName: text('encrypted_name').notNull(),
  encryptedStartDate: text('encrypted_start_date').notNull(),
  encryptedEndDate: text('encrypted_end_date').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

const travelPreferences = sqliteTable('travel_preferences', {
  userId: text('user_id').primaryKey().references(() => accounts.id, { onDelete: 'cascade' }),
  encryptedExcludedCategoryIds: text('encrypted_excluded_category_ids').notNull(),
  updatedAt: text('updated_at').notNull(),
});

const iconAssets = sqliteTable('icon_assets', {
  id: text('id').primaryKey(), contentHash: text('content_hash').notNull(), storageKey: text('storage_key').notNull(),
  byteSize: integer('byte_size').notNull(), width: integer('width').notNull(), height: integer('height').notNull(), status: text('status').notNull(),
  submittedBy: text('submitted_by').references(() => accounts.id, { onDelete: 'set null' }), reviewedBy: integer('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(), reviewedAt: text('reviewed_at'), rejectionReason: text('rejection_reason'),
});
const iconRules = sqliteTable('icon_rules', {
  id: text('id').primaryKey(), iconAssetId: text('icon_asset_id').notNull().references(() => iconAssets.id, { onDelete: 'cascade' }), entityType: text('entity_type').notNull(),
  displayName: text('display_name').notNull(), normalizedPattern: text('normalized_pattern').notNull(), matchType: text('match_type').notNull(), priority: integer('priority').notNull().default(0), status: text('status').notNull(),
  submittedBy: text('submitted_by').references(() => accounts.id, { onDelete: 'set null' }), reviewedBy: integer('reviewed_by').references(() => users.id, { onDelete: 'set null' }), exampleText: text('example_text'),
  createdAt: text('created_at').notNull(), reviewedAt: text('reviewed_at'), rejectionReason: text('rejection_reason'),
});

const expenses = sqliteTable('expenses', {
  id:          text('id').primaryKey(),
  spendingId:  text('spending_id').notNull().references(() => monthlySpending.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  amount:      real('amount').notNull(),
  category:    text('category'),
  date:        text('date'),
  data:        text('data'), // JSON blob for any extra fields
  encryptedPayload: text('encrypted_payload'),
  hiddenAt: text('hidden_at'),
});

const financialProfiles = sqliteTable('financial_profiles', {
  id:                    integer('id').primaryKey({ autoIncrement: true }),
  userId:                text('user_id').notNull().unique().references(() => accounts.id, { onDelete: 'cascade' }),
  monthlyIncome:         real('monthly_income').notNull().default(0),
  yearlyIncome:          real('yearly_income').notNull().default(0),
  percentToSave:         real('percent_to_save').notNull().default(0),
  percentToContribute:   real('percent_to_contribute').notNull().default(0),
  monthlySavingTarget:   real('monthly_saving_target').notNull().default(0),
  monthlySpendLimit:     real('monthly_spend_limit').notNull().default(0),
  yearlyIncomeAfterTax:  real('yearly_income_after_tax').notNull().default(0),
  budgetCategories:      text('budget_categories').default('[]'), // JSON array
  reportingCurrency:     text('reporting_currency').notNull().default('USD'),
});

const goals = sqliteTable('goals', {
  id:        text('id').primaryKey(),
  userId:    text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  data:      text('data'), // JSON blob for target, current, deadline, etc.
});

const monthlySavingsTargets = sqliteTable('monthly_savings_targets', {
  id:                    text('id').primaryKey(),
  userId:                text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  year:                  integer('year').notNull(),
  month:                 integer('month').notNull(),
  monthlyAfterTaxIncome: real('monthly_after_tax_income').notNull(),
  percentToSave:         real('percent_to_save').notNull(),
  targetAmount:          real('target_amount').notNull(),
  capturedAt:            text('captured_at').notNull(),
}, (table) => [uniqueIndex('monthly_savings_targets_user_period_idx').on(table.userId, table.year, table.month)]);

const categories = sqliteTable('categories', {
  id:     integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name:   text('name').notNull(),
  color:  text('color').notNull(),
}, (table) => [uniqueIndex('categories_user_name_idx').on(table.userId, table.name)]);

// Privacy-neutral, administrator-managed category names shared by every
// account. Customer provenance is intentionally not stored here.
const defaultCategories = sqliteTable('default_categories', {
  id:             integer('id').primaryKey({ autoIncrement: true }),
  name:           text('name').notNull(),
  normalizedName: text('normalized_name').notNull().unique(),
  color:          text('color').notNull(),
  createdAt:      text('created_at').notNull(),
});

const categoryRules = sqliteTable('category_rules', {
  id:                 text('id').primaryKey(),
  userId:             text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  normalizedMerchant: text('normalized_merchant').notNull(),
  merchantLabel:      text('merchant_label'),
  effectiveFrom:      text('effective_from').notNull().default('1970-01-01'),
  categoryId:         integer('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  categoryIds:        text('category_ids').notNull().default('[]'),
  sourceExpenseId:    text('source_expense_id').references(() => expenses.id, { onDelete: 'set null' }),
  matchCount:         integer('match_count').notNull().default(0),
  createdAt:          text('created_at').notNull(),
  lastMatchedAt:      text('last_matched_at'),
}, (table) => [uniqueIndex('category_rules_user_merchant_idx').on(table.userId, table.normalizedMerchant)]);

const detectedSubscriptions = sqliteTable('detected_subscriptions', {
  id:                text('id').primaryKey(),
  userId:            text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  description:       text('description').notNull(),
  variants:          text('variants').default('[]'), // JSON array
  averageAmount:     real('average_amount').notNull(),
  totalPaid:         real('total_paid').notNull(),
  firstDetected:     text('first_detected'),
  lastPayment:       text('last_payment'),
  isActive:          integer('is_active', { mode: 'boolean' }).notNull().default(true),
  occurrences:       integer('occurrences').notNull(),
  consecutiveMonths: integer('consecutive_months').notNull(),
});

const subscriptionLinks = sqliteTable('subscription_links', {
  id:                   text('id').primaryKey(),
  userId:               text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  sourceSubscriptionId: text('source_subscription_id').notNull().references(() => detectedSubscriptions.id, { onDelete: 'cascade' }),
  targetSubscriptionId: text('target_subscription_id').notNull().references(() => detectedSubscriptions.id, { onDelete: 'cascade' }),
  createdAt:            text('created_at').notNull(),
}, (table) => [
  uniqueIndex('subscription_links_user_source_idx').on(table.userId, table.sourceSubscriptionId),
]);

const excludedFromSubscriptions = sqliteTable('excluded_from_subscriptions', {
  id:                  integer('id').primaryKey({ autoIncrement: true }),
  userId:              text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  description:         text('description').notNull(),
  originalDescription: text('original_description'),
  excludedAt:          text('excluded_at').notNull(),
});

const mfaTokens = sqliteTable('mfa_tokens', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  userId:    integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  purpose:   text('purpose').notNull().default('mfa'),
  expiresAt: text('expires_at').notNull(),
  usedAt:    text('used_at'),
  createdAt: text('created_at').notNull(),
});

const trustedDevices = sqliteTable('trusted_devices', {
  id:         text('id').primaryKey(),
  userId:     integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash:  text('token_hash').notNull().unique(),
  deviceName: text('device_name').notNull(),
  userAgent:  text('user_agent'),
  createdAt:  text('created_at').notNull(),
  lastUsedAt: text('last_used_at').notNull(),
  lastIp:     text('last_ip'),
  expiresAt:  text('expires_at').notNull(),
});

const authSecurityEvents = sqliteTable('auth_security_events', {
  id:               text('id').primaryKey(),
  reason:           text('reason').notNull(),
  attemptedEmails:  text('attempted_emails').notNull().default('[]'),
  ipAddress:        text('ip_address').notNull(),
  deviceId:         text('device_id'),
  deviceFingerprint: text('device_fingerprint'),
  firstSeenAt:      text('first_seen_at').notNull(),
  lastSeenAt:       text('last_seen_at').notNull(),
  blockedUntil:     text('blocked_until').notNull(),
  hitCount:         integer('hit_count').notNull().default(1),
  clearedAt:        text('cleared_at'),
  clearedBy:        integer('cleared_by'),
}, (table) => [index('auth_security_events_active_idx').on(table.clearedAt, table.blockedUntil)]);

const rateLimitBuckets = sqliteTable('rate_limit_buckets', {
  bucketKey: text('bucket_key').primaryKey(),
  hitCount: integer('hit_count').notNull(),
  resetAt: integer('reset_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [index('rate_limit_buckets_reset_idx').on(table.resetAt)]);

const notifications = sqliteTable('notifications', {
  id:        text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  type:      text('type').notNull().default('info'),
  title:     text('title').notNull(),
  message:   text('message').notNull(),
  metadata:  text('metadata').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
  readAt:    text('read_at'),
}, (table) => [index('notifications_account_created_idx').on(table.accountId, table.createdAt)]);

const netWorthSnapshots = sqliteTable('net_worth_snapshots', {
  id:         text('id').primaryKey(),
  userId:     text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  period:     integer('period').notNull(),
  year:       integer('year').notNull(),
  month:      integer('month').notNull(),
  value:      real('value').notNull(),
  isFinal:    integer('is_final', { mode: 'boolean' }).notNull().default(false),
  capturedAt: text('captured_at').notNull(),
  reportingCurrency: text('reporting_currency').notNull().default('USD'),
});

const fxRateSnapshots = sqliteTable('fx_rate_snapshots', {
  id:        text('id').primaryKey(),
  rateDate:  text('rate_date').notNull(),
  currency:  text('currency').notNull(),
  perEur:    text('per_eur').notNull(),
  source:    text('source').notNull().default('ECB'),
  fetchedAt: text('fetched_at').notNull(),
}, (table) => [uniqueIndex('fx_rates_date_currency_idx').on(table.rateDate, table.currency)]);

const simplefinConnections = sqliteTable('simplefin_connections', {
  id:                  text('id').primaryKey(),
  userId:              text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  encryptedAccessUrl:  text('encrypted_access_url').notNull(),
  encryptionKeyVersion: integer('encryption_key_version').notNull().default(1),
  status:              text('status').notNull().default('active'),
  createdAt:           text('created_at').notNull(),
  lastSyncStartedAt:   text('last_sync_started_at'),
  lastSyncSucceededAt: text('last_sync_succeeded_at'),
  nextSyncAllowedAt:   text('next_sync_allowed_at'),
  autoSyncEnabled:     integer('auto_sync_enabled', { mode: 'boolean' }).notNull().default(true),
  syncMinute:          integer('sync_minute').notNull().default(17),
  nextScheduledSyncAt: text('next_scheduled_sync_at'),
  lastError:           text('last_error'),
}, (table) => [index('simplefin_connections_user_id_idx').on(table.userId)]);

const simplefinAccounts = sqliteTable('simplefin_accounts', {
  id:               text('id').primaryKey(),
  connectionId:     text('connection_id').notNull().references(() => simplefinConnections.id, { onDelete: 'cascade' }),
  remoteAccountId:  text('remote_account_id').notNull(),
  remoteConnectionId: text('remote_connection_id'),
  remoteName:       text('remote_name').notNull(),
  institutionName: text('institution_name'),
  currency:         text('currency').notNull(),
  balance:          text('balance').notNull(),
  availableBalance: text('available_balance'),
  balanceDate:      text('balance_date'),
  isActive:         integer('is_active', { mode: 'boolean' }).notNull().default(true),
  firstSeenAt:      text('first_seen_at').notNull(),
  lastSeenAt:       text('last_seen_at').notNull(),
  rawData:          text('raw_data'),
}, (table) => [
  uniqueIndex('simplefin_accounts_connection_remote_idx').on(table.connectionId, table.remoteAccountId),
]);

const financialAccountLinks = sqliteTable('financial_account_links', {
  id:                     text('id').primaryKey(),
  userId:                 text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  simplefinAccountId:     text('simplefin_account_id').notNull().references(() => simplefinAccounts.id, { onDelete: 'cascade' }),
  localAccountType:       text('local_account_type'),
  localAccountId:         text('local_account_id'),
  status:                 text('status').notNull().default('deferred'),
  balanceSource:          text('balance_source').notNull().default('simplefin'),
  transactionSyncEnabled: integer('transaction_sync_enabled', { mode: 'boolean' }).notNull().default(false),
  transactionImportFrom: text('transaction_import_from'),
  transactionSyncedThrough: text('transaction_synced_through'),
  createdAt:              text('created_at').notNull(),
  linkedAt:               text('linked_at'),
  unlinkedAt:             text('unlinked_at'),
}, (table) => [
  index('financial_account_links_user_id_idx').on(table.userId),
  index('financial_account_links_simplefin_account_idx').on(table.simplefinAccountId),
]);

const simplefinTransactions = sqliteTable('simplefin_transactions', {
  id:                  text('id').primaryKey(),
  simplefinAccountId:  text('simplefin_account_id').notNull().references(() => simplefinAccounts.id, { onDelete: 'cascade' }),
  remoteTransactionId: text('remote_transaction_id').notNull(),
  postedAt:            text('posted_at').notNull(),
  transactedAt:        text('transacted_at'),
  amount:              text('amount').notNull(),
  description:         text('description').notNull(),
  pending:             integer('pending', { mode: 'boolean' }).notNull().default(false),
  firstSeenAt:         text('first_seen_at').notNull(),
  lastSeenAt:          text('last_seen_at').notNull(),
  rawData:             text('raw_data'),
  expenseId:           text('expense_id').references(() => expenses.id, { onDelete: 'set null' }),
  classification:      text('classification'),
  classificationSource: text('classification_source'),
  classificationReason: text('classification_reason'),
}, (table) => [
  uniqueIndex('simplefin_transactions_account_remote_idx').on(table.simplefinAccountId, table.remoteTransactionId),
]);

const simplefinSyncRuns = sqliteTable('simplefin_sync_runs', {
  id:                  text('id').primaryKey(),
  connectionId:        text('connection_id').notNull().references(() => simplefinConnections.id, { onDelete: 'cascade' }),
  startedAt:           text('started_at').notNull(),
  completedAt:         text('completed_at'),
  status:              text('status').notNull(),
  trigger:             text('trigger').notNull().default('manual'),
  accountsReceived:    integer('accounts_received').notNull().default(0),
  transactionsInserted: integer('transactions_inserted').notNull().default(0),
  transactionsUpdated: integer('transactions_updated').notNull().default(0),
  warnings:            text('warnings'),
  errorCode:           text('error_code'),
  errorSummary:        text('error_summary'),
  expensesMaterialized: integer('expenses_materialized').notNull().default(0),
  duplicateCandidates: integer('duplicate_candidates').notNull().default(0),
}, (table) => [index('simplefin_sync_runs_connection_idx').on(table.connectionId)]);

const simplefinDuplicateCandidates = sqliteTable('simplefin_duplicate_candidates', {
  id:                     text('id').primaryKey(),
  userId:                 text('user_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  simplefinTransactionId: text('simplefin_transaction_id').notNull().unique().references(() => simplefinTransactions.id, { onDelete: 'cascade' }),
  possibleExpenseId:      text('possible_expense_id').references(() => expenses.id, { onDelete: 'set null' }),
  status:                 text('status').notNull().default('pending'),
  score:                  real('score').notNull(),
  createdAt:              text('created_at').notNull(),
  resolvedAt:             text('resolved_at'),
}, (table) => [index('simplefin_duplicate_candidates_user_idx').on(table.userId, table.status)]);

module.exports = {
  users,
  accounts,
  accountFeatureFlags,
  customerEncryptionKeys,
  creditCards,
  bankAccounts,
  tradingAccounts,
  monthlySpending,
  splitPeople,
  travelPlans,
  travelPreferences,
  iconAssets,
  iconRules,
  expenses,
  financialProfiles,
  goals,
  monthlySavingsTargets,
  categories,
  defaultCategories,
  categoryRules,
  detectedSubscriptions,
  subscriptionLinks,
  excludedFromSubscriptions,
  mfaTokens,
  trustedDevices,
  authSecurityEvents,
  rateLimitBuckets,
  notifications,
  netWorthSnapshots,
  fxRateSnapshots,
  simplefinConnections,
  simplefinAccounts,
  financialAccountLinks,
  simplefinTransactions,
  simplefinSyncRuns,
  simplefinDuplicateCandidates,
};
