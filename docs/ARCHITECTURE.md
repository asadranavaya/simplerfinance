# Architecture and data design

## System shape

SimplerFinance is a modular monolith:

```text
React/Vite browser application
        |
        | same-origin JSON API + SSE
        v
Express application
  |-- authentication and authorization middleware
  |-- domain route modules
  |-- background schedulers
  |-- customer encryption layer
  |
  |-- application SQLite database
  |-- service-log SQLite database
  `-- normalized icon files
```

In development, Vite and Express run separately. In production, Express can serve the compiled `dist/` directory, keeping cookies and API calls same-origin. A reverse proxy or Cloudflare Tunnel provides public TLS.

## Frontend

`renderer/src/App.jsx` defines public, protected, and administrator routes. Authentication, selected account, and appearance are provided through React contexts. Pages use a shared sidebar for ordinary users; administrators receive a reduced navigation set for the admin control center and settings.

The primary user surfaces are overview, accounts, monthly spending, analytics/category browser, subscriptions, and settings. Large pages retain server-side business rules and use client state for presentation, forms, modals, accordions, and transitions. CSS variables in `renderer/src/App.css` carry the theme rather than hard-coded page-specific palettes.

## API and authorization

`server/index.js` mounts public authentication and health routes before `requireAuth`. Every other `/api` route passes through authentication and service telemetry. Domain routers live under `server/routes`; reusable policy and data transformations live under `server/lib`.

The authenticated identity contains a login-user ID, customer account ID, email, and role. Most financial records belong to the account ID, allowing a strict tenant boundary. Routes must derive that account ID from the verified session, never from an arbitrary client parameter. Administrator routes add `requireAdmin` and deliberately operate across accounts.

## Data stores

The application database is SQLite using `better-sqlite3` and Drizzle ORM. WAL mode improves read/write coexistence on one host. Core table families include:

- identity: users, accounts, MFA tokens, trusted devices, feature flags;
- finance: bank accounts, credit cards, trading accounts, profiles, goals, monthly savings targets, net-worth snapshots;
- spending: monthly containers, expenses, categories, categorization rules, split people, travel plans, subscription detections and customer-owned subscription links;
- SimpleFIN: connections, remote accounts, local links, staged transactions, sync runs, duplicate candidates;
- operations: notifications, rate-limit buckets, security events, icon assets and icon rules;
- encryption: one wrapped customer key per account.

Telemetry is intentionally separated into `service-logs.db`. Separation keeps high-churn, short-retention operational data out of the durable finance database and lets operators discard telemetry without damaging customer records. It is not a security boundary: both files are available to the host process.

## Manual and synchronized accounts

Local accounts are the durable, user-facing model. A SimpleFIN account is a provider-side projection, and `financial_account_links` connects exactly one remote account to a local bank, card, or trading account. This layer permits customer-friendly local names and existing manual history without changing provider identifiers.

Remote transactions are staged before becoming local expenses. The staged record retains provider IDs, lifecycle state, raw data, classification, and a pointer to the materialized expense. This provides idempotency, duplicate review, pending reconciliation, and a place to inspect provider data without forcing provider semantics into the main spending UI.

## Derived data

Several values are projections rather than independent source-of-truth entries:

- SimpleFIN balances update linked local account display data.
- Materialized expenses are derived from staged provider transactions but can retain customer metadata.
- category rules apply a stored tag set from an effective date and take precedence over provider category hints;
- provider category hints are a lower-priority fallback, while travel tags remain additive;
- subscription detections are recomputed from eligible expense history;
- monthly savings targets are captured once per month so later salary changes do not rewrite history;
- net-worth snapshots preserve monthly values and finalize past months.

Derived systems should be idempotent: repeating a sync or rule application must not duplicate records or progressively mutate results.

## Background work

The Node process starts schedulers for SimpleFIN, foreign-exchange rates, and operational maintenance. This design avoids another worker service, but background work stops whenever the API stops and only one scheduler process should be active against a database. Multi-instance deployment would require leader election or an external job queue.

## Notifications

Durable notification events live in SQLite and are pushed to the browser through server-sent events. SSE is one-directional, simple, and compatible with same-origin cookie authentication. Proxies must disable buffering and use long read timeouts. The browser must tolerate reconnection because transient QUIC, DNS, and network errors are normal.

## Scaling trade-offs

The current architecture optimizes for a trusted single host:

- SQLite is excellent for low administration and backups but is not a shared multi-node database.
- Local icon assets avoid object-storage complexity but must move with the deployment.
- in-process schedulers are simple but should not run concurrently on multiple replicas;
- the persistent SQLite rate limiter survives restarts and covers processes sharing one database, but does not coordinate separate databases;
- the service telemetry histogram is computed from bounded recent rows rather than a distributed metrics backend.

Moving to horizontal scale would require a transactional network database, shared object storage, distributed rate-limit state, a job system, centralized metrics, and careful migration of envelope keys.
