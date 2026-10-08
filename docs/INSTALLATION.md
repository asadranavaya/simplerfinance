# Installation and first-run guide

## Decision table

| Goal | Choose | Host requirements | Email option | Process manager |
| --- | --- | --- | --- | --- |
| Develop or evaluate source | `local` setup | Node.js 22+, npm | none or real SMTP | foreground `npm run dev` |
| Small persistent Linux host | `pm2` setup | Node.js 22+, npm, PM2 | real SMTP recommended | PM2 |
| Native locked-down Linux service | `pm2` setup, then systemd installer | Node.js 22+, npm, root for unit install | real SMTP recommended | systemd |

## Guided setup in detail

Run `npm run setup` from the repository root. The wizard is intentionally conservative:

- it never overwrites `.env`;
- it masks passwords and does not place them in child-process arguments;
- it generates secrets with Node's cryptographic random generator;
- it uses separate values for session signing, customer-key wrapping, and optional SimpleFIN credentials;
- it defaults browser registration off;
- it does not transmit configuration or telemetry anywhere;
- it creates directories and databases only on the selected host.

### Deployment prompt

`local` writes `NODE_ENV=development` and installs dependencies. `pm2` writes production configuration, installs dependencies, and defaults to building the frontend.

### Email prompt

`none` leaves SMTP blank. Setup-created identities are already active and verified, so login works, but any action that must prove mailbox control remains unavailable.

`smtp` asks for a host, port, implicit-TLS setting, optional username/password, and From address. Port 465 normally uses implicit TLS; port 587 normally starts plaintext then upgrades with STARTTLS. Provider-specific application passwords, sender verification, and network rules are outside the app.

### Identity prompts

The administrator controls users, security events, approved icons, beta flags, and telemetry but does not receive the personal-finance sidebar. The normal user receives accounts, spending, analytics, subscriptions, and settings. For a single operator who needs both surfaces, create two separate emails/identities. They can use aliases delivered to the same controlled mailbox, but unique passwords are preferable.

Setup and `npm run create-user` are trusted local provisioning paths: they mark the email verified without sending a code. Use them only when operating the host. For untrusted remote users, enable browser registration temporarily and require the email verification flow.

## Doctor output

`PASS` means the local invariant was observed. `WARN` means the app can run with reduced capability, such as no SMTP in development. `FAIL` means production startup or a documented operation is expected to fail. Doctor does not send a test email or make a SimpleFIN request because those actions have side effects; test them explicitly after login.

Useful commands:

```bash
npm run doctor
npm run doctor -- --live
npm run doctor -- --smtp  # verifies SMTP without sending a message
npm run check:public
```

## Native dependency failures

Most common platforms receive prebuilt binaries. If `npm ci` fails while building `better-sqlite3`, `bcrypt`, or `sharp`, install the host's compiler, Python, `make`, and development headers, then retry. Examples vary by distribution; prefer the package names documented for your OS and remove unused compilers from a hardened runtime host if policy requires it.

## PM2 lifecycle

```bash
bash scripts/install-pm2.sh
pm2 status
pm2 logs budget-api
pm2 describe budget-backup
pm2 save
```

PM2's startup integration is OS-specific. Run `pm2 startup`, inspect the generated elevated command, execute it once, and then `pm2 save`. The installer does not automatically execute a generated root command.

## systemd lifecycle

The systemd installer uses the current checkout path and invoking non-root user. Moving the repository later invalidates unit paths. A root shell must explicitly set `BUDGET_APP_USER` to a dedicated unprivileged account. Inspect units, especially `User`, `WorkingDirectory`, `ExecStart`, and `ReadWritePaths`:

```bash
bash scripts/install-systemd.sh
systemctl cat budget-app.service
systemctl status budget-app.service
journalctl -u budget-app.service -f
systemctl list-timers budget-app-backup.timer
```

Do not run both PM2 and systemd app services against the same database simultaneously: that starts duplicate schedulers. A backup timer may coexist with one app process because it uses SQLite's backup API.

## Remaining operator bottlenecks

Automation cannot safely choose or create these external resources:

- SMTP account, application password, sender verification, and deliverability;
- public domain, Cloudflare account/tunnel, DNS, and optional Access policy;
- firewall rules ensuring the origin cannot bypass the proxy;
- off-host encrypted backup destination and retention;
- MaxMind license/database for approximate IP location;
- SimpleFIN Bridge subscription/claim token;
- OS updates, disk encryption, monitoring, and incident response.

The app intentionally reports these as configuration choices rather than hiding insecure defaults.
