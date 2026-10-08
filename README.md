# SimplerFinance

> Your financial life, on your infrastructure.

SimplerFinance is a self-hosted personal-finance application for manual budgeting and optional read-only account synchronization through [SimpleFIN Bridge](https://www.simplefin.org/). It combines account balances, monthly transactions, category analytics, subscription detection, travel tagging, expense splitting, financial goals, notifications, and administrative operations in one responsive web application.

The project is intentionally single-service and SQLite-based. That makes it approachable for one household or a small trusted deployment, but it is not a hosted banking service and has not been independently security audited. Operate it as sensitive infrastructure: use TLS, strong unique secrets, restricted host access, tested backups, and prompt dependency updates.

## What is included

- React 19 and Vite frontend with responsive desktop/mobile layouts and account-scoped themes.
- Express 5 API with cookie-based JWT sessions, email verification, password recovery, optional email MFA, remembered devices, and session revocation.
- SQLite application database plus a separate seven-day service-telemetry database.
- Manual bank, credit-card, and trading accounts; historical account closure; monthly expenses and CSV/PDF import.
- Per-user categories, multi-tag merchant rules, analytics, spending charts, split purchases, travel plans, goals, and net-worth snapshots.
- SimpleFIN connection discovery, account linking, bounded transaction windows, scheduled synchronization, pending-to-posted reconciliation, duplicate review, and transaction materialization.
- Subscription detection requiring three consecutive monthly payments with stable amounts.
- In-app notifications delivered through server-sent events.
- Administrator control center for users, account status, trusted devices, beta flags, security activity, SimpleFIN health, icon review, and read-only telemetry queries.
- Bundled v1 merchant, institution, product, and category icon rules resolved entirely on the local host.
- Customer-scoped envelope encryption for selected sensitive fields and separately encrypted SimpleFIN credentials.

## Fastest setup

### Guided local or PM2 setup

Requirements are Node.js 22+ and npm. Clone the repository and run one guided command:

```bash
git clone https://github.com/OWNER/REPOSITORY.git
cd REPOSITORY
npm run setup
```

The setup wizard:

- installs exact root and frontend dependencies;
- generates independent JWT and customer encryption keys without printing them;
- asks whether SimpleFIN should be enabled and generates its key only when needed;
- supports real SMTP or a private installation with email disabled;
- creates a verified administrator and a separate verified finance user with masked password prompts;
- builds the frontend when appropriate;
- runs `npm run doctor` and prints the exact next command.

Choose `local` to run the Vite frontend and API for development:

```bash
npm run dev
# open http://localhost:5173
```

Choose `pm2` for a persistent production process, then run:

```bash
bash scripts/install-pm2.sh
pm2 startup   # run the command PM2 prints, once
```

The PM2 installer performs a clean dependency install, tests, builds, starts/reloads the API, and installs a daily 02:00 database backup job.

### Manual setup

Operators who prefer explicit configuration can run:

```bash
npm run bootstrap
cp .env.example .env
# Replace the required placeholders and configure optional services.
npm run doctor
npm run create-admin -- admin@example.com 'a-long-unique-password' 'Administrator'
npm run create-user -- user@example.com 'another-long-password' 'Household'
npm run build
NODE_ENV=production npm run server
```

Command-line passwords can appear in shell history or process listings. The guided setup avoids that by reading them through a masked prompt. `create-user` deliberately creates a locally verified user for a trusted self-hoster; public onboarding should use email-verified browser registration.

### Email choices

- **No email:** adequate for a private account provisioned by setup, but registration, MFA, recovery, and email changes cannot deliver codes.
- **Real SMTP:** required for real users, internet hosting, password recovery, and email MFA.

Leave `ALLOW_REGISTRATION=false` unless the server is intentionally accepting new browser registrations.

## PM2 and Cloudflare Tunnel

This is a convenient internet-facing arrangement when inbound ports should remain closed:

```text
browser -> Cloudflare edge/TLS -> cloudflared outbound tunnel -> localhost:3001 -> Express + SQLite
```

Install PM2 and `cloudflared` using their official packages, authenticate Cloudflare, create a named tunnel, and map a hostname to `http://localhost:3001`. The exact Cloudflare commands change over time, so follow Cloudflare's current Tunnel documentation rather than copying stale tokens into this repository.

Run guided PM2 setup or install directly:

```bash
bash scripts/install-pm2.sh
pm2 startup
```

Start the tunnel as a separate PM2 process, replacing the placeholder with your configured tunnel name:

```bash
pm2 start cloudflared --name budget-tunnel -- tunnel run YOUR_TUNNEL_NAME
pm2 save
```

Important Cloudflare/PM2 considerations:

- Keep the tunnel credentials outside the repository with owner-only permissions.
- Do not expose port 3001 publicly through the host firewall. Bind or firewall it for local/tunnel access.
- The production app trusts one reverse-proxy hop. Ensure every production request actually traverses the trusted local proxy/tunnel path; otherwise forwarded client-IP headers can become attacker-controlled.
- Disable caching for `/api/*`. Server-sent events at `/api/notifications/stream` must not be buffered and need a long read timeout.
- The PM2 installer schedules local backups, but off-host copies still require operator configuration.
- Run `pm2 logs budget-api` after deployment and check `/api/health`.

An nginx TLS/reverse-proxy example is included in `nginx.conf` for deployments that terminate TLS locally instead of at Cloudflare.

## systemd alternative

After guided `pm2` setup (or a manual production build), install a native service and daily backup timer instead of PM2:

```bash
bash scripts/install-systemd.sh
systemctl status budget-app
systemctl list-timers budget-app-backup.timer
```

To add only the backup timer to another service arrangement:

```bash
bash scripts/install-backup-timer.sh
```

Review generated units in `/etc/systemd/system/` before using them on a hardened or multi-user host.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Yes in deployment | Use `production` to enable secure cookies, production proxy behavior, and built frontend serving. |
| `PORT` | No | API port; defaults to `3001`. |
| `JWT_SECRET` | Production | Signs session and staged-authentication tokens. Production requires at least 32 characters. Rotation invalidates active sessions. |
| `ALLOW_REGISTRATION` | No | Set to `true` only while self-registration should be available. Default recommendation is `false`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | For email flows | SMTP transport for verification codes and security messages. |
| `BUDGET_DB_PATH` | No | Application SQLite path; defaults to `data/budget.db`. |
| `SERVICE_LOG_DB_PATH` | No | Telemetry SQLite path; defaults beside the application database as `service-logs.db`. |
| `SIMPLEFIN_ENCRYPTION_KEY` | For SimpleFIN | 32-byte hex key encrypting SimpleFIN access URLs. Back it up separately. |
| `CUSTOMER_DATA_MASTER_KEY` | Strongly recommended | 32-byte hex key wrapping each customer's unique data key. If absent, a local key file is generated under `.secrets/`. |
| `MAXMIND_CITY_DB_PATH` | Optional | Local GeoLite2 City database used for approximate IP location in the admin console. |

Never commit `.env`, `.secrets/`, Cloudflare credentials, SQLite files, database sidecars, backups, logs, or uploaded icon assets. See [Security](docs/SECURITY.md) for key lifecycle and threat-model details.

The checked-in `library/` catalog is different from runtime uploads: it contains the reviewed, checksummed v1 icon seed distributed with the source. Fresh databases import it idempotently, while equivalent administrator rules remain authoritative. Third-party marks are covered by the catalog's own notices rather than the source-code license.

## Common commands

```bash
npm run dev                 # API and Vite development servers
npm run setup               # guided installation, secrets, and account provisioning
npm run doctor              # validate environment and installation
npm run bootstrap           # exact root and renderer dependency installation
npm run server              # API only
npm run build               # production frontend
npm test                    # Node test suite
npm run create-admin -- ... # create or promote an administrator
npm run create-user -- ...  # create a verified local finance user
npm run backup              # create an application database backup
npm run verify-backup       # validate the newest backup
npm run hot-reload          # build and restart the PM2 budget-api process
```

## Runtime data and backup boundaries

The application creates runtime state under `data/` and `.secrets/`; both are ignored by Git.

- `budget.db`, `budget.db-wal`, `budget.db-shm`: customer/application data.
- `service-logs.db*`: seven-day request telemetry.
- `icon-assets/`: normalized approved and pending icon variants.
- `.secrets/customer-data-master-key`: auto-generated wrapping key when the environment variable is absent.
- `.secrets/maxmind/`: optional IP-geolocation database and credentials.
- `backups/`: local backup output.

A usable disaster-recovery set includes the main database, icon assets, `CUSTOMER_DATA_MASTER_KEY` (or its generated key file), every configured SimpleFIN encryption key version, and deployment configuration. Backing up only SQLite is insufficient because encrypted customer data cannot be recovered without the keys. Telemetry is operational and may be excluded if losing it is acceptable.

## Documentation

- [Architecture and data design](docs/ARCHITECTURE.md)
- [Installation and first-run guide](docs/INSTALLATION.md)
- [User and administrator flows](docs/USER_AND_ADMIN_GUIDE.md)
- [Security model and operator responsibilities](docs/SECURITY.md)
- [SimpleFIN integration](docs/SIMPLEFIN.md)
- [Telemetry and operational visibility](docs/TELEMETRY.md)
- [Operations, backup, and recovery](docs/OPERATIONS.md)
- [Shared merchant rule and icon library](docs/ICON_RULE_LIBRARY.md)
- [Contributing and public-release workflow](CONTRIBUTING.md)

## Project status and trade-offs

SQLite, a single Node process, and local filesystem assets keep self-hosting simple and inexpensive. The corresponding trade-offs are single-host write concurrency, local state that must be backed up, and no built-in horizontal scaling. Email MFA is easier to self-host than passkeys or TOTP but depends on SMTP and the security of the email account. The built-in telemetry console is powerful for an operator, but administrator compromise exposes operational metadata and account controls; isolate and strongly protect admin credentials.

Before exposing a fork publicly, review every item in [Security](docs/SECURITY.md), run the test suite, scan the final snapshot for secrets, and test a restore on a different directory or host.

## License

MIT. See [LICENSE](LICENSE).
