# Security model

## Scope and assumptions

SimplerFinance protects personal financial data on a self-hosted server. It assumes the host operating system, Node process, environment, and master keys are controlled by the operator. Envelope encryption reduces database-only exposure; it cannot protect data from an attacker who controls the running process and keys. The project has not received an independent penetration test and should not be described as audited or compliant.

## Authentication and sessions

- Passwords use bcrypt hashes.
- JWTs are stored in HTTP-only cookies and verified on each request.
- Production startup requires an explicit `JWT_SECRET` of at least 32 characters.
- A database session version supports global revocation after password/email/security changes.
- Account activation requires email ownership verification.
- Email codes are random, short-lived, purpose-scoped, hashed at rest, rate-limited, and one-time use.
- Optional email MFA can trust a device through a random server-issued token whose hash is stored in SQLite.
- Remembered-device identifiers are not hardware attestation. A user controls browser input; security comes from the high-entropy secret token and server-side hash, not an unforgeable physical device ID.

Initial privileged provisioning is intentionally a local terminal operation rather than an unauthenticated browser wizard. A remotely reachable “first visitor becomes admin” flow creates a race during deployment and expands the public authentication surface. `npm run setup` provides the same guided experience while requiring host control.

Cookies and forwarded-IP behavior depend on `NODE_ENV=production` and a correct proxy boundary. Never operate internet-facing authentication over plaintext HTTP.

## Authorization and tenancy

The session resolves both login user and account ownership. Customer financial routes must scope every read and write to `req.user.accountId`. IDs are untrusted selectors, not proof of ownership. Admin endpoints are isolated by role middleware and should return only the operational data needed by the console.

## Rate limiting

Authentication controls combine IP, signed browser identity, and email/account identities. Counters live in SQLite so they survive a restart and are shared by processes using the same database. Security events make blocks visible and clearable to administrators.

IP addresses remain context rather than identity. VPNs and botnets rotate addresses; forwarded headers can be spoofed if an attacker reaches Express without traversing the trusted proxy. Restrict the origin port and ensure the configured `trust proxy` hop matches the real topology.

## Encryption at rest

The data model uses envelope encryption:

1. Each customer account receives a random 256-bit data-encryption key.
2. The customer key is wrapped with the deployment master key using AES-256-GCM and authenticated associated data containing account/key versions.
3. Selected customer fields are encrypted with that customer's key using a unique random nonce and purpose-bound associated data.
4. Blind HMAC indexes permit limited equality lookup without storing the comparable plaintext in those protected fields.

The master key lives outside the database in `CUSTOMER_DATA_MASTER_KEY` or an owner-only `.secrets/customer-data-master-key` file. The wrapped per-customer keys live in SQLite. Changing or losing the master key makes wrapped data keys—and therefore protected customer data—unreadable. Copying a customer's ciphertext to another account or field fails because the associated-data purpose changes.

This is selective field encryption, not full-database encryption. Relational fields needed for queries and calculations remain plaintext, including many numeric values, dates, status fields, IDs, and some display columns. SQLite files, WAL files, backups, telemetry, and filesystem metadata can still reveal significant information. Use encrypted disks/volumes and protected backups for broader at-rest coverage.

SimpleFIN access URLs have a separate deployment key, `SIMPLEFIN_ENCRYPTION_KEY`, and versioned envelope. Keeping this key distinct limits accidental key reuse, although both keys are available to the same process.

## Input and upload controls

JSON bodies are limited to 50 KB and globally reject unsafe object shapes. Domain routes impose allowlists, lengths, numeric/date bounds, and ownership checks. Icon uploads use an in-memory one-file limit, allowlisted MIME types, a 1 MB input cap, a decoded-pixel cap, SVG validation, raster normalization, output caps, per-user/daily rate limits, and a global queue maximum of 50.

No parser or sanitizer is perfect. Keep `sharp`, Express, React, PDF/CSV parsing dependencies, and Node updated. Treat uploaded content and imported files as attacker-controlled.

## Browser and transport controls

Helmet supplies CSP and other security headers. The CSP blocks arbitrary scripts, frames, objects, remote images, and remote connections; inline styles remain allowed because the UI uses dynamic style properties. Production CORS is disabled in favor of same-origin requests. TLS belongs at nginx or the Cloudflare edge.

## Administrator hardening

The admin account is the highest-risk identity. Recommended controls:

- use a real operator-controlled email address and enable MFA;
- use a password-manager-generated unique password;
- avoid browsing or email in the same browser profile;
- do not use the admin identity for personal finance;
- revoke trusted devices and sessions after any concern;
- restrict admin access at Cloudflare Access, a VPN, or firewall layer when possible;
- monitor security activity and service errors;
- keep at least one offline recovery procedure for the database and keys.

Email MFA does not protect against compromise of the mailbox. Passkeys or hardware-backed WebAuthn would be a valuable future improvement.

## Secret rotation

- `JWT_SECRET`: replacement signs new sessions and invalidates old cookies; plan a forced login.
- `CUSTOMER_DATA_MASTER_KEY`: do not simply replace it. Every wrapped customer key must be atomically rewrapped under a versioned new master key first.
- `SIMPLEFIN_ENCRYPTION_KEY`: retain old versioned keys until all access URLs are re-encrypted; otherwise customers must reconnect.
- SMTP and Cloudflare credentials: rotate through their providers and restart with updated environment.

There is not yet an automated master-key rotation command. Treat key rotation as a migration and test it against a backup.

## Vulnerability reports

Do not place sensitive vulnerability details or real customer data in a public issue. Repository owners should publish a private security contact in the hosting platform's security policy before accepting outside users.
