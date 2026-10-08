# SimpleFIN integration

## Purpose and trust boundary

SimpleFIN Bridge gives the application a read-only access URL for account and transaction data. The URL is effectively a credential: anyone holding it may retrieve the customer's financial feed. SimplerFinance encrypts it at rest, never returns it to the browser after exchange, sanitizes provider errors, and supports disconnecting or permanently deleting connection data.

The integration follows the public SimpleFIN protocol but institutions vary in names, transaction lifecycle behavior, balances, holdings, and `extra` metadata. Provider data is untrusted input and must be bounded before storage or display.

## Connection flow

1. The customer obtains a setup/claim token from SimpleFIN Bridge.
2. The API validates the claim URL (HTTPS, public address, no embedded credentials where prohibited) and exchanges it server-side.
3. The returned access URL is encrypted with `SIMPLEFIN_ENCRYPTION_KEY`.
4. Discovery stores remote accounts without changing existing manual accounts.
5. The linking wizard relates each remote account to at most one local account or creates a new local account.
6. The customer chooses an initial transaction import boundary and enables transaction synchronization.

The local link is deliberate. It preserves manual history, lets customers rename accounts without fighting provider names, and makes disconnect/reconnect behavior explicit.

## Synchronization windows

SimpleFIN recommends bounded request windows. Initial history is fetched in windows capped at 45 days with overlap. After the initial boundary has been consumed, normal sync advances from the persisted cursor while retaining a recent overlap (including a 14-day pending-reconciliation horizon). This avoids repeatedly requesting the original import date forever.

Manual sync is throttled; scheduled synchronization runs roughly every six hours at a persisted per-connection minute. Success advances from the intended schedule slot to avoid drift. Pause, provider backoff, and stale lock recovery are respected. The scheduler is in-process, so only one application scheduler should run against a database.

## Staging and materialization

Provider transactions first enter `simplefin_transactions`, uniquely keyed by remote account and remote transaction ID. Staging preserves posted/transacted timestamps, decimal amount, description, pending state, raw provider payload, classification, and materialized expense ID.

Materialization then:

- maps provider sign conventions and classifies purchases, income, refunds, transfers, and uncertain transactions;
- avoids converting card payments or uncertain rails into ordinary spending without review;
- links or creates the correct monthly expense container;
- updates provider-controlled amount/date/status fields while preserving allowed customer metadata;
- respects a customer's hidden/tombstoned imported expense so sync cannot revive it;
- creates duplicate candidates instead of silently duplicating likely manual entries.

## Pending reconciliation

A pending authorization can post under the same ID or appear as a replacement with a new description/ID. Sync checks recent pending records against successfully covered account responses. Strong unambiguous candidates reconcile into the posted record and can repair an untouched pending descriptor. Customer-edited merchant names are preserved. A pending item absent from a successfully covered response may be retired after the reconciliation rules; ambiguous candidates are not guessed.

Reconciliation failure is account-scoped when provider errors identify an account. A failure for one of sixteen accounts does not prevent successful accounts from reconciling. Connection-wide or unscoped provider failures remain conservative and block reconciliation for the affected connection because completeness cannot be proven.

## Categories and priority

SimpleFIN permits provider-specific `extra` data but does not guarantee a category schema. The parser recognizes bounded common category shapes and ignores unrelated fields. Priority is:

1. customer merchant/category rule;
2. customer-selected categories;
3. provider category hint;
4. derived `Uncategorized` when no real category exists.

Travel tags are additive and do not suppress provider category fallback. Unknown provider categories are handled according to the materialization/category policy rather than being allowed to create unlimited arbitrary data. The expense diagnostics beta feature exposes the sanitized staged/provider data for opted-in accounts when investigating a provider's shape.

## Notifications and telemetry

Synchronization produces one aggregated user notification after the UTC day closes instead of one notification per run. Background sync operations enter the main service telemetry set under the affected subscriber ID with `user_type=impersonated_user` and bounded string counters such as `simplefin_sync=1`.

## Disconnect versus delete

Disconnecting drops the usable credential and stops future synchronization while retaining locally materialized finance history according to the current connection state. Permanent connection-data deletion is a separate destructive action that removes provider-derived connection records and proven imported data. Back up first and make the customer confirm the distinction.

## Operational failure modes

- Lost SimpleFIN encryption key: stored access URLs cannot be recovered; customers reconnect.
- Provider partial response: only proven-complete accounts reconcile pending absences.
- Rate/backoff response: scheduler waits until allowed time; admin can clear only the local manual-sync cooldown.
- Changed institution identifiers: account discovery may stage a new remote account requiring linking.
- Duplicate manual/imported history: resolve candidates rather than deleting blindly.
- Clock/timezone confusion: provider timestamps are retained separately; date-only historical records cannot invent a reliable transaction time.
