# Operations, backup, and recovery

## Production checklist

- Run a supported Node.js LTS release under a dedicated unprivileged OS account.
- Set `NODE_ENV=production` and unique JWT, customer-master, and SimpleFIN keys.
- Use a real SMTP account and verify registration, MFA, email-change, and recovery delivery.
- Keep `ALLOW_REGISTRATION=false` except when deliberately onboarding users.
- Terminate TLS at a maintained reverse proxy or Cloudflare edge.
- Firewall the origin so untrusted clients cannot bypass the proxy.
- Put `data/`, `.secrets/`, backups, and tunnel credentials on owner-only paths.
- Enable disk encryption and operating-system security updates.
- Configure PM2 startup and log rotation.
- Test backup and restore before adding real financial data.
- Create a real-email admin with MFA and restrict its use.

## Installation automation

`npm run setup` is the preferred entry point. It supports local and PM2 modes, writes a new owner-only `.env` only when one does not already exist, generates independent secrets, optionally configures SimpleFIN, provisions local identities, and invokes the doctor. It refuses to replace an existing `.env`; back up or move that file deliberately before regenerating configuration.

`npm run doctor` checks Node, both dependency trees, required production secrets, optional SimpleFIN key shape, SMTP configuration, writable state directories, production build output, and the public-release file policy. Use `npm run doctor -- --live` while the service is running to check `/api/health`; use `npm run doctor -- --smtp` to verify SMTP connectivity/authentication without sending a message. Warnings describe optional/degraded capabilities; failures exit nonzero.

Deployment helpers:

- `scripts/install-pm2.sh`: clean install, tests, build, PM2 app, daily PM2 backup job, and saved process list;
- `scripts/install-systemd.sh`: native app unit plus persistent daily backup timer;
- `scripts/install-backup-timer.sh`: backup timer without installing the app service.

The scripts do not configure a firewall, TLS certificate, Cloudflare account, SMTP provider, off-host backup destination, or OS patching. Those remain operator-specific security boundaries.

## Health and logs

`GET /api/health` returns a minimal unauthenticated liveness response. It proves that Express is accepting requests, not that SMTP, SimpleFIN, backups, MaxMind, or every database operation is healthy.

With PM2:

```bash
pm2 status
pm2 logs budget-api --lines 200
curl -fsS http://127.0.0.1:3001/api/health
```

The admin dashboard adds SimpleFIN connection health, security activity, and seven-day service telemetry. Configure external uptime checks against health without exposing admin endpoints.

## Backups

Use the included command to create a consistent SQLite backup:

```bash
npm run backup
npm run verify-backup
```

Schedule it with systemd timers or cron and copy completed backups off-host. Do not copy a live SQLite database plus WAL with ordinary file copy and assume consistency; use SQLite's backup mechanism or stop the application cleanly.

Install the included daily systemd schedule with:

```bash
bash scripts/install-backup-timer.sh
```

PM2 users receive the same daily application backup job from `scripts/install-pm2.sh`. In every model, configure a separate encrypted off-host copy; a local timer does not protect against host loss.

Back up as one recovery set:

1. application database backup;
2. `data/icon-assets/` if icons matter;
3. `CUSTOMER_DATA_MASTER_KEY` or `.secrets/customer-data-master-key`;
4. `SIMPLEFIN_ENCRYPTION_KEY` and any retained versioned keys;
5. SMTP/tunnel/deployment configuration through a secret manager;
6. optional MaxMind configuration, which can also be recreated.

Store keys separately from at least one copy of the database, but ensure a documented recovery process can reunite them. Losing the wrapping key is permanent data loss for protected fields. Protect backups from ransomware with versioning or offline copies.

## Restore drill

Restore into a separate directory or host, not over the live database:

1. install the same application release and dependencies;
2. stop the restored API process;
3. place the verified database at the configured `BUDGET_DB_PATH`;
4. restore icon assets and secret keys with restrictive permissions;
5. start one API instance and inspect migration output;
6. test login, encrypted field access, account balances, a historical month, and SimpleFIN connection status;
7. do not enable scheduled synchronization until the restored environment is intentionally promoted.

A restore that opens SQLite but lacks the right master key is not successful.

## Deployments and upgrades

```bash
git pull --ff-only
npm ci
npm ci --prefix renderer
npm test
npm run build
pm2 restart budget-api --update-env
```

Back up immediately before pulling a release that changes schema or encryption. Review release notes and `.env.example` for new variables. The schema installer is designed to be idempotent, but downgrade migrations are not promised.

## Cloudflare-specific notes

Cloudflare Tunnel keeps an outbound connection from `cloudflared` to Cloudflare and can avoid opening public inbound ports. It does not remove the need to secure the origin host, admin identity, application secrets, and backups.

Use a hostname route to `http://localhost:3001`, disable caching for API traffic, and permit long-lived SSE responses. Cloudflare Access in front of administrator routes is valuable defense in depth, but ensure ordinary customer routes remain usable according to your deployment model. Only trust `CF-Connecting-IP`/forwarded headers when the origin cannot be reached except through the controlled proxy path.

Transient HTTP/3/QUIC console errors can occur between browser and edge. SSE clients should reconnect with backoff. Persistent DNS or tunnel errors require checking the tunnel process, hostname routing, edge status, and host network.

## Capacity

Monitor disk space for the main DB, WAL growth, icon uploads, backups, and logs. The telemetry database retains one week but traffic volume still determines its peak size. SQLite works well for a modest single-host workload; sustained write contention, large customer counts, or multiple API replicas are signals to plan a network database and external job/metrics systems.
