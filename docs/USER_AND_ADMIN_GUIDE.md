# User and administrator flows

## Identity lifecycle

When registration is enabled, a visitor supplies a name, email, and password. The server validates and rate-limits the request, sends a six-digit email code, and keeps the account pending until that code is verified. Responses are designed to reduce account-existence disclosure. Login issues an HTTP-only session cookie; accounts with email MFA enabled must complete a second code unless a valid remembered-device token is present.

A user can recover a forgotten password only after completing a purpose-specific email-code flow. Password changes rotate the session version, clear trusted devices, and invalidate other sessions. Email changes require proof of access to the new address, clear trusted devices, rotate sessions, and are limited by the configured annual policy. Deactivated users are rejected on their next authenticated request and forced out.

For private self-hosting, the guided setup and local `create-user` command provide a separate trusted provisioning path. Those accounts are immediately active and email-verified without sending mail; this is convenient for a host owner but must not be exposed as a public API. Browser registration remains the correct path for users who must prove mailbox ownership.

## Ordinary user navigation

### Overview

The overview summarizes balances, spending, category distribution, savings progress, and net worth. The net-worth series uses monthly snapshots; the current month remains fluid and older months can be finalized. Sensitive net-worth display can be blurred from the sidebar.

### Accounts

Users create manual bank, credit-card, and trading accounts. SimpleFIN accounts remain separate provider records until linked to a manual account. Closing a local account removes it from future activity entry while preserving historical months and expenses. Trading accounts can show provider-exposed holdings when available.

### Monthly spending

The page opens at the current year and month. Account rows expand one at a time into transactions. Users can add or import expenses, assign multiple categories, select a primary category, remember a normalized merchant rule, split a purchase, edit eligible fields, or hide/delete an imported transaction. Hiding a SimpleFIN expense also records the suppression so later synchronization does not revive it.

Synced amount and date fields remain provider-controlled. Pending transactions are visible, then reconciled to posted records when provider identifiers or descriptions change. Errors returned by the API should appear in the relevant modal; unexpected server errors also expose a request ID in a dismissible banner for operator correlation.

### Analytics and category browser

Analytics provides period totals, averages, change indicators, spending-over-time, category mix, weekday patterns, merchants, accounts, and highlights. The Category Browser underneath filters exact purchases by category and custom date range. Users can remove the selected category from a purchase and inspect or update splits. Selecting a travel plan routes directly to this section with the trip name and date range preselected.

Categories are account-scoped. `Uncategorized` is derived only when no real category is present and cannot be deliberately applied alongside real tags. A remembered merchant rule stores all selected tags and an effective-from date; reapplication replaces unrelated non-travel tags, while travel tags remain additive.

### Subscription calendar

Detection groups similar merchant descriptions, then requires at least one run of three consecutive monthly charges whose adjacent amounts differ by no more than three dollars. Once that recurrence is established, compatible payments across later or earlier gaps remain part of its history, while only one representative charge is selected per month. This keeps a briefly interrupted subscription active when recent matching payments resume without admitting unrelated same-merchant purchases. When brittle provider descriptions produce duplicate subscriptions, a user can manually link one detection into another. That explicit choice overrides the automatic amount-variance rule for the linked merchant: one representative matching charge per month refreshes its history and activity, with the charge closest to its established amount selected when a merchant posts more than once in a month. The linked entry disappears from the primary list, contributes its history and variants to the retained entry, survives later detection runs, and can be unlinked from the “Also appears as” chips. If a later run cannot rediscover either linked row, it is retained as cancelled instead of destroying the customer's grouping. Users can exclude false positives. The calendar displays resolved merchant icons, falling back to the primary category icon.

### Travel plans

Settings allows a trip name and inclusive start/end dates. Eligible expenses within the range receive the trip name in addition to their normal categories. Auto-detected subscriptions remain excluded. Users may select other account categories to exclude from travel tagging, such as routine bills. Editing or deleting a trip reapplies derived tags.

### Split people

Users define people in Settings, then allocate an expense by percentages or fixed amounts. Multiple people can be added until no eligible person remains. Allocations must account for the intended total, and spending summaries use the portion actually paid by the customer.

### SimpleFIN

The settings workflow exchanges a claim token, discovers remote accounts, and presents a linking wizard. Each remote account links to at most one local manual account; a local account can be created from the wizard. Users choose an initial import boundary, review duplicates/classifications, enable scheduled synchronization, disconnect credentials, or permanently remove connection data after explicit confirmation. See [SimpleFIN](SIMPLEFIN.md).

### Settings

Settings uses focused subpages for email, password, MFA/trusted-device revocation, appearance, merchant categorization, split people, travel, and SimpleFIN. Appearance is persisted per account. Revoking all devices also revokes sessions, including the current one.

## Administrator navigation

Administrators land on a dedicated dashboard and do not receive ordinary financial navigation. The hub links to four operational areas:

### Account Control Center

The account list shows role, verification, activation state, and account identity. Opening a user reveals trusted devices, approximate last-used location, SimpleFIN status, and beta features. Administrators can remove one trusted device, clear a SimpleFIN manual-sync cooldown, deactivate/reactivate eligible users, and permanently delete a non-admin only after deactivation. The console prevents self-deactivation and does not allow administrator deletion.

### Icon Management

Customers may submit bounded merchant/institution/product icon proposals; administrators can additionally create category rules. Uploads are restricted by type, byte size, decoded pixel count, daily/user limits, and a global queue cap. The server sanitizes SVG input and normalizes accepted content into 32, 64, and 128 pixel WebP variants. Administrators approve/reject submissions and edit existing approved rules or images.

### Security Activity

Persistent login, registration, and email-code limiters create security events containing the reason, attempted identities, normalized IP, signed browser-device fingerprint, counts, and block expiry. If a local MaxMind database is configured, the UI adds an approximate city/region/country. Administrators can clear an active rate-limit event. This is an operational control, not an intrusion-detection system.

### Telemetry

Latency charts show hourly p50, p90, and p99 by HTTP method for 24 hours or seven days. A read-only SQL console queries the bounded service-log database. Admin API requests are intentionally excluded from the customer data-plane log. Background SimpleFIN operations are recorded as impersonated-user operations with counters. See [Telemetry](TELEMETRY.md).

## Role separation trade-off

An administrator can manage every account and inspect operational metadata, so compromise has a broad blast radius even though encrypted fields remain protected by host-held keys. Use a real controlled email address, strong unique password, email MFA, a restricted admin browser profile, and minimal daily use. A future passkey/TOTP implementation would reduce dependency on email; it is not currently built in.
