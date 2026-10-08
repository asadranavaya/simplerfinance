# Contributing

Contributions should preserve the project's core properties: customer isolation, self-hostability, bounded resource use, explicit ownership checks, responsive behavior, and recoverable data migrations.

## Development workflow

1. Fork and clone the repository.
2. Run `npm run setup` and choose local mode, or manually copy `.env.example`.
3. Use `npm run bootstrap` for an exact root and renderer dependency installation.
4. Create a focused branch.
5. Add or update tests for behavior changes.
6. Run `npm test`, `npm run lint --prefix renderer`, `npm run build`, `npm run doctor`, `npm run check:public`, and `git diff --check`.
7. Confirm no database, `.env`, key, credential, uploaded asset, build output, or personal hostname is staged.

Prefer existing React components, CSS variables, Express middleware, validation helpers, and Drizzle tables. Avoid accepting `userId` or `accountId` from customer-controlled request bodies; derive ownership from `req.user.accountId`. Any new query must include the account boundary unless it is an explicitly administrator-only aggregate.

## Database changes

The application currently performs idempotent SQLite schema setup/migrations from `server/db/index.js`, while table declarations live in `server/db/schema.js`. Changes must be safe when applied more than once and safe against an existing populated database. Never solve a migration by deleting or recreating the user's database.

For encrypted fields, use the customer-data helpers and a stable, documented purpose string. Changing a purpose string breaks authentication of existing ciphertext unless a migration decrypts with the old purpose and re-encrypts with the new one.

## Security-sensitive changes

Authentication, account deletion, encryption, uploads, SimpleFIN credentials, rate limiting, telemetry SQL, and admin endpoints deserve negative tests as well as happy-path tests. Validate object shape, type, length, date ranges, numeric bounds, ownership, and state transitions on the server. Frontend validation is for usability and is never the security boundary.

Do not add analytics, crash reporting, remote icon retrieval, or other outbound data flows without prominent documentation and an explicit operator/customer choice.

## Public snapshot without history

To publish only the reviewed working tree to a brand-new public repository, do this in a separate temporary directory after committing or stashing local work:

```bash
git archive --format=tar HEAD | tar -x -C /path/to/empty/public-snapshot
cd /path/to/empty/public-snapshot
git init -b main
git add .
git status
git commit -m "Initial open-source release"
git remote add origin git@github.com:OWNER/REPOSITORY.git
git push -u origin main
```

`git archive HEAD` exports committed files only and excludes Git history. If the release includes uncommitted changes, create a reviewed release commit first. Before pushing, search the extracted snapshot—not merely the original repository—and verify that `find . -type f` contains no runtime data. Tools such as Gitleaks or TruffleHog are useful additional checks, but they do not replace manual review.

Do not run `git init` inside the existing deployment directory: that risks losing useful history and confusing the running checkout. Do not push this repository's existing branch to the new public remote if the objective is a history-free release.
