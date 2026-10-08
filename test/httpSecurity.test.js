const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const app = require('../server/index');
const { db, sqlite } = require('../server/db');
const { users, accounts, accountFeatureFlags, categories, defaultCategories, authSecurityEvents, creditCards, bankAccounts, tradingAccounts, mfaTokens, trustedDevices } = require('../server/db/schema');
const { eq } = require('drizzle-orm');
const { JWT_SECRET } = require('../server/middleware/auth');
const { revealFinancialAccountData } = require('../server/lib/customerDataFields');
const { queryServiceLogs } = require('../server/lib/serviceTelemetry');

function seedHttpSecurityFixtures() {
  const now = new Date().toISOString();
  const fixtures = [
    { accountId: 'test-admin-account', name: 'Test administrator', email: 'admin@test.example.invalid', role: 'admin' },
    { accountId: 'test-member-one', name: 'Test member one', email: 'member-one@test.example.invalid', role: 'user' },
    { accountId: 'test-member-two', name: 'Test member two', email: 'member-two@test.example.invalid', role: 'user' },
  ];
  for (const fixture of fixtures) {
    db.insert(accounts).values({ id: fixture.accountId, name: fixture.name }).run();
    db.insert(users).values({
      email: fixture.email,
      passwordHash: 'test-only-not-a-login-password',
      accountId: fixture.accountId,
      createdAt: now,
      role: fixture.role,
      isActive: true,
      emailVerifiedAt: now,
    }).run();
  }
}

seedHttpSecurityFixtures();

async function withServer(run) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('protected financial routes reject unauthenticated requests', async () => {
  await withServer(async base => {
    for (const path of ['/api/categories', '/api/simplefin/connections', '/api/fx', '/api/net-worth']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 401, path);
      assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/i, path);
    }
  });
});

test('authenticated data-plane requests emit queryable service telemetry', async () => {
  const member = db.select().from(users).all().find(user => user.accountId === 'test-member-one');
  await withServer(async base => {
    const token = jwt.sign({ userId: member.id }, JWT_SECRET, { expiresIn: '1m' });
    const response = await fetch(`${base}/api/categories`, { headers: { cookie: `token=${token}` } });
    assert.equal(response.status, 200);
    const requestId = response.headers.get('x-request-id');
    assert.match(requestId, /^[0-9a-f-]{36}$/i);

    const result = queryServiceLogs(`SELECT * FROM service_request_logs WHERE request_id = '${requestId}'`);
    assert.equal(result.rowCount, 1);
    assert.equal(result.rows[0].subscriber_id, member.accountId);
    assert.equal(result.rows[0].user_type, 'user');
    assert.equal(result.rows[0].method, 'GET');
    assert.equal(result.rows[0].status_code, 200);
    assert.ok(result.rows[0].latency_ms >= 0);
    assert.match(result.rows[0].start_time, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(result.rows[0].data_plane_call, '/api/categories/');
  });
});

test('service-log SQL is admin-only and read-only over HTTP', async () => {
  const admin = db.select().from(users).all().find(user => user.accountId === 'test-admin-account');
  const member = db.select().from(users).all().find(user => user.accountId === 'test-member-one');
  await withServer(async base => {
    const request = (user, query) => fetch(`${base}/api/admin/telemetry/query`, {
      method: 'POST',
      headers: { cookie: `token=${jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1m' })}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    assert.equal((await request(member, 'SELECT COUNT(*) AS count FROM service_request_logs')).status, 403);
    const allowed = await request(admin, 'SELECT COUNT(*) AS count FROM service_request_logs');
    assert.equal(allowed.status, 200);
    assert.equal(typeof (await allowed.json()).rows[0].count, 'number');
    const rejected = await request(admin, 'DELETE FROM service_request_logs');
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /read-only/i);

    const latency = await fetch(`${base}/api/admin/telemetry/latency?hours=24`, {
      headers: { cookie: `token=${jwt.sign({ userId: admin.id }, JWT_SECRET, { expiresIn: '1m' })}` },
    });
    assert.equal(latency.status, 200);
    const latencyBody = await latency.json();
    assert.equal(latencyBody.rangeHours, 24);
    assert.equal(latencyBody.points.length, 24);
  });
});

test('JSON request bodies above 50kb are rejected', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${'x'.repeat(52000)}@example.com`, password: 'password' }),
    });
    assert.equal(response.status, 413);
  });
});

test('dangerous object keys and non-object JSON bodies are rejected globally', async () => {
  await withServer(async base => {
    const dangerous = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{"email":"test@example.com","password":"password","__proto__":{"admin":true}}',
    });
    assert.equal(dangerous.status, 400);
    assert.match((await dangerous.json()).error, /prohibited property/i);

    const arrayBody = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]',
    });
    assert.equal(arrayBody.status, 400);
    assert.match((await arrayBody.json()).error, /JSON object/i);

    const malformed = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":',
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: 'Request body contains invalid JSON.' });
  });
});

test('authentication routes issue a signed HTTP-only browser identifier', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 400);
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('auth_device='));
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
  });
});

test('registration rate limits create a removable security audit event', async (t) => {
  await withServer(async base => {
    const attemptedEmail = `${crypto.randomUUID()}@example.invalid`;
    let response;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.210' },
        body: JSON.stringify({ email: attemptedEmail }),
      });
    }
    assert.equal(response.status, 429);
    const event = db.select().from(authSecurityEvents).all().find(row => row.ipAddress === '198.51.100.210');
    assert.ok(event);
    assert.equal(event.reason, 'Excessive account registration attempts');
    assert.match(event.attemptedEmails, new RegExp(attemptedEmail.replace('.', '\\.')));
    const { clearSecurityEvent } = require('../server/lib/securityActivity');
    clearSecurityEvent(event.id, 1);
    t.after(() => db.delete(authSecurityEvents).where(eq(authSecurityEvents.id, event.id)).run());
  });
});

test('account activation requires a pending email-verification session', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/auth/register/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ otp: '123456' }),
    });
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /verification session expired/i);
  });
});

test('email verification and token-purpose columns are installed', () => {
  const { sqlite } = require('../server/db');
  const userColumns = sqlite.prepare('PRAGMA table_info(users)').all().map(column => column.name);
  const tokenColumns = sqlite.prepare('PRAGMA table_info(mfa_tokens)').all().map(column => column.name);
  assert.ok(userColumns.includes('email_verified_at'));
  assert.ok(tokenColumns.includes('purpose'));
});

test('administrators cannot activate an email-unverified account', async (t) => {
  const admin = db.select().from(users).all().find(user => user.isActive && user.role === 'admin');
  if (!admin) return t.skip('requires an active admin fixture');
  const accountId = `verification-test-${crypto.randomUUID()}`;
  db.insert(accounts).values({ id: accountId, name: 'Pending verification test' }).run();
  const pending = db.insert(users).values({
    email: `${crypto.randomUUID()}@example.invalid`,
    passwordHash: 'not-used',
    accountId,
    createdAt: new Date().toISOString(),
    isActive: false,
    emailVerifiedAt: null,
  }).returning().get();
  t.after(() => {
    db.delete(users).where(eq(users.id, pending.id)).run();
    db.delete(accounts).where(eq(accounts.id, accountId)).run();
  });

  await withServer(async base => {
    const token = jwt.sign({ userId: admin.id }, JWT_SECRET, { expiresIn: '1m' });
    const response = await fetch(`${base}/api/admin/users/${pending.id}/status`, {
      method: 'PATCH',
      headers: { cookie: `token=${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    });
    assert.equal(response.status, 409);
    assert.equal(db.select().from(users).where(eq(users.id, pending.id)).get().isActive, false);
  });
});

test('admin deletion requires deactivation and removes both user and account roots', async (t) => {
  const admin = db.select().from(users).all().find(user => user.isActive && user.role === 'admin');
  if (!admin) return t.skip('requires an active admin fixture');
  const accountId = `deletion-test-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.insert(accounts).values({ id: accountId, name: 'Admin deletion test' }).run();
  const target = db.insert(users).values({
    email: `${crypto.randomUUID()}@example.invalid`, passwordHash: 'not-used', accountId,
    createdAt: now, emailVerifiedAt: now, isActive: true,
  }).returning().get();
  t.after(() => {
    db.delete(users).where(eq(users.id, target.id)).run();
    db.delete(accounts).where(eq(accounts.id, accountId)).run();
  });

  await withServer(async base => {
    const token = jwt.sign({ userId: admin.id }, JWT_SECRET, { expiresIn: '1m' });
    const headers = { cookie: `token=${token}` };
    const activeResponse = await fetch(`${base}/api/admin/users/${target.id}`, { method: 'DELETE', headers });
    assert.equal(activeResponse.status, 409);

    db.update(users).set({ isActive: false }).where(eq(users.id, target.id)).run();
    const deletedResponse = await fetch(`${base}/api/admin/users/${target.id}`, { method: 'DELETE', headers });
    assert.equal(deletedResponse.status, 200);
    assert.equal(db.select().from(users).where(eq(users.id, target.id)).get(), undefined);
    assert.equal(db.select().from(accounts).where(eq(accounts.id, accountId)).get(), undefined);
  });
});

test('deactivated sessions receive the forced-sign-out response code', async (t) => {
  const accountId = `inactive-session-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.insert(accounts).values({ id: accountId, name: 'Inactive session test' }).run();
  const target = db.insert(users).values({
    email: `${crypto.randomUUID()}@example.invalid`, passwordHash: 'not-used', accountId,
    createdAt: now, emailVerifiedAt: now, isActive: false,
  }).returning().get();
  t.after(() => {
    db.delete(users).where(eq(users.id, target.id)).run();
    db.delete(accounts).where(eq(accounts.id, accountId)).run();
  });

  await withServer(async base => {
    const token = jwt.sign({ userId: target.id }, JWT_SECRET, { expiresIn: '1m' });
    const response = await fetch(`${base}/api/accounts`, { headers: { cookie: `token=${token}` } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'ACCOUNT_INACTIVE');
  });
});

test('a session-version change revokes old tokens while the current version remains valid', async (t) => {
  const member = db.select().from(users).all().find(user => user.accountId && user.isActive && user.role !== 'admin');
  if (!member) return t.skip('requires a non-admin fixture account');
  const originalVersion = member.sessionVersion;
  t.after(() => db.update(users).set({ sessionVersion: originalVersion }).where(eq(users.id, member.id)).run());

  await withServer(async base => {
    const oldToken = jwt.sign({ userId: member.id, sessionVersion: originalVersion }, JWT_SECRET, { expiresIn: '1m' });
    db.update(users).set({ sessionVersion: originalVersion + 1 }).where(eq(users.id, member.id)).run();

    const revoked = await fetch(`${base}/api/auth/me`, { headers: { cookie: `token=${oldToken}` } });
    assert.equal(revoked.status, 401);
    assert.equal((await revoked.json()).code, 'SESSION_REVOKED');

    const currentToken = jwt.sign({ userId: member.id, sessionVersion: originalVersion + 1 }, JWT_SECRET, { expiresIn: '1m' });
    const current = await fetch(`${base}/api/auth/me`, { headers: { cookie: `token=${currentToken}` } });
    assert.equal(current.status, 200);
  });
});

test('verified email changes clear trusted devices, rotate sessions, and start the annual cooldown', async (t) => {
  const accountId = `email-change-${crypto.randomUUID()}`;
  const oldEmail = `${crypto.randomUUID()}@example.invalid`;
  const newEmail = `${crypto.randomUUID()}@example.invalid`;
  const password = 'email-change-test-password';
  const code = '482913';
  const now = new Date().toISOString();
  db.insert(accounts).values({ id: accountId, name: 'Email change test' }).run();
  const target = db.insert(users).values({
    email: oldEmail,
    pendingEmail: newEmail,
    passwordHash: await bcrypt.hash(password, 4),
    accountId,
    createdAt: now,
    emailVerifiedAt: now,
    isActive: true,
  }).returning().get();
  db.insert(mfaTokens).values({
    userId: target.id,
    tokenHash: await bcrypt.hash(code, 4),
    purpose: 'email_change',
    createdAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }).run();
  db.insert(trustedDevices).values({
    id: crypto.randomUUID(), userId: target.id, tokenHash: crypto.randomBytes(32).toString('hex'),
    deviceName: 'Test device', createdAt: now, lastUsedAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }).run();
  t.after(() => {
    db.delete(users).where(eq(users.id, target.id)).run();
    db.delete(accounts).where(eq(accounts.id, accountId)).run();
  });

  await withServer(async base => {
    const oldToken = jwt.sign({ userId: target.id, sessionVersion: 0 }, JWT_SECRET, { expiresIn: '1m' });
    const verified = await fetch(`${base}/api/auth/email/verify`, {
      method: 'POST',
      headers: { cookie: `token=${oldToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ otp: code }),
    });
    assert.equal(verified.status, 200);
    assert.equal((await verified.json()).email, newEmail);
    const updated = db.select().from(users).where(eq(users.id, target.id)).get();
    assert.equal(updated.email, newEmail);
    assert.equal(updated.pendingEmail, null);
    assert.equal(updated.sessionVersion, 1);
    assert.ok(updated.lastEmailChangedAt);
    assert.equal(db.select().from(trustedDevices).where(eq(trustedDevices.userId, target.id)).all().length, 0);

    const revoked = await fetch(`${base}/api/auth/me`, { headers: { cookie: `token=${oldToken}` } });
    assert.equal((await revoked.json()).code, 'SESSION_REVOKED');

    const freshCookie = verified.headers.getSetCookie().find(value => value.startsWith('token='));
    assert.ok(freshCookie);
    const cooldown = await fetch(`${base}/api/auth/email`, {
      method: 'PUT',
      headers: { cookie: freshCookie.split(';')[0], 'content-type': 'application/json' },
      body: JSON.stringify({ newEmail: `${crypto.randomUUID()}@example.invalid`, password }),
    });
    assert.equal(cooldown.status, 429);
    assert.match((await cooldown.json()).error, /once per year/i);
  });
});

test('password recovery is account-private and requires code verification before choosing a password', async (t) => {
  const accountId = `password-reset-${crypto.randomUUID()}`;
  const email = `${crypto.randomUUID()}@example.invalid`;
  const oldPassword = 'old-password-for-reset';
  const newPassword = 'new-password-for-reset';
  const code = '731924';
  const now = new Date().toISOString();
  db.insert(accounts).values({ id: accountId, name: 'Password reset test' }).run();
  const target = db.insert(users).values({
    email, passwordHash: await bcrypt.hash(oldPassword, 4), accountId, createdAt: now,
    emailVerifiedAt: now, isActive: true,
  }).returning().get();
  db.insert(mfaTokens).values({
    userId: target.id, tokenHash: await bcrypt.hash(code, 4), purpose: 'password_reset',
    createdAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }).run();
  db.insert(trustedDevices).values({
    id: crypto.randomUUID(), userId: target.id, tokenHash: crypto.randomBytes(32).toString('hex'),
    deviceName: 'Reset test device', createdAt: now, lastUsedAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }).run();
  t.after(() => {
    db.delete(users).where(eq(users.id, target.id)).run();
    db.delete(accounts).where(eq(accounts.id, accountId)).run();
  });

  await withServer(async base => {
    const unknown = await fetch(`${base}/api/auth/password/forgot`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.77' },
      body: JSON.stringify({ email: `${crypto.randomUUID()}@example.invalid` }),
    });
    assert.equal(unknown.status, 202);
    assert.match((await unknown.json()).message, /if an account exists/i);

    const pendingToken = jwt.sign({ userId: target.id, stage: 'password_reset_pending' }, JWT_SECRET, { expiresIn: '1m' });
    const verified = await fetch(`${base}/api/auth/password/forgot/verify`, {
      method: 'POST', headers: { cookie: `password_reset_pending=${pendingToken}`, 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.78' },
      body: JSON.stringify({ otp: code }),
    });
    assert.equal(verified.status, 200);
    const authorizedCookie = verified.headers.getSetCookie().find(value => value.startsWith('password_reset_authorized='));
    assert.ok(authorizedCookie);

    const reset = await fetch(`${base}/api/auth/password/forgot/reset`, {
      method: 'PUT', headers: { cookie: authorizedCookie.split(';')[0], 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    });
    assert.equal(reset.status, 200);
    const updated = db.select().from(users).where(eq(users.id, target.id)).get();
    assert.equal(updated.sessionVersion, 1);
    assert.equal(await bcrypt.compare(newPassword, updated.passwordHash), true);
    assert.equal(db.select().from(trustedDevices).where(eq(trustedDevices.userId, target.id)).all().length, 0);
    assert.equal(db.select().from(mfaTokens).where(eq(mfaTokens.userId, target.id)).all().length, 0);
  });
});

test('administrators can remove only the selected trusted device for a user', async (t) => {
  const admin = db.select().from(users).all().find(user => user.isActive && user.role === 'admin');
  if (!admin) return t.skip('requires an active admin fixture');
  const member = db.select().from(users).all().find(user => user.isActive && user.role !== 'admin');
  if (!member) return t.skip('requires an active member fixture');
  const now = new Date().toISOString();
  const selectedId = crypto.randomUUID();
  const retainedId = crypto.randomUUID();
  for (const id of [selectedId, retainedId]) {
    db.insert(trustedDevices).values({
      id, userId: member.id, tokenHash: crypto.randomBytes(32).toString('hex'), deviceName: 'Admin removal test',
      createdAt: now, lastUsedAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }).run();
  }
  t.after(() => {
    for (const id of [selectedId, retainedId]) db.delete(trustedDevices).where(eq(trustedDevices.id, id)).run();
  });

  await withServer(async base => {
    const token = jwt.sign({ userId: admin.id, sessionVersion: admin.sessionVersion }, JWT_SECRET, { expiresIn: '1m' });
    const response = await fetch(`${base}/api/admin/users/${member.id}/trusted-devices/${selectedId}`, {
      method: 'DELETE', headers: { cookie: `token=${token}` },
    });
    assert.equal(response.status, 200);
    assert.equal(db.select().from(trustedDevices).where(eq(trustedDevices.id, selectedId)).get(), undefined);
    assert.ok(db.select().from(trustedDevices).where(eq(trustedDevices.id, retainedId)).get());
  });
});

test('users can revoke all sessions and trusted devices including their current session', async (t) => {
  const accountId = `revoke-sessions-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.insert(accounts).values({ id: accountId, name: 'Session revocation test' }).run();
  const target = db.insert(users).values({
    email: `${crypto.randomUUID()}@example.invalid`, passwordHash: 'not-used', accountId,
    createdAt: now, emailVerifiedAt: now, isActive: true,
  }).returning().get();
  for (let index = 0; index < 2; index += 1) {
    db.insert(trustedDevices).values({
      id: crypto.randomUUID(), userId: target.id, tokenHash: crypto.randomBytes(32).toString('hex'), deviceName: 'Revocation test',
      createdAt: now, lastUsedAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }).run();
  }
  t.after(() => {
    db.delete(users).where(eq(users.id, target.id)).run();
    db.delete(accounts).where(eq(accounts.id, accountId)).run();
  });

  await withServer(async base => {
    const token = jwt.sign({ userId: target.id, sessionVersion: 0 }, JWT_SECRET, { expiresIn: '1m' });
    const response = await fetch(`${base}/api/auth/sessions/revoke-all`, { method: 'POST', headers: { cookie: `token=${token}` } });
    assert.equal(response.status, 200);
    assert.equal(db.select().from(trustedDevices).where(eq(trustedDevices.userId, target.id)).all().length, 0);
    assert.equal(db.select().from(users).where(eq(users.id, target.id)).get().sessionVersion, 1);
    const revoked = await fetch(`${base}/api/auth/me`, { headers: { cookie: `token=${token}` } });
    assert.equal((await revoked.json()).code, 'SESSION_REVOKED');
  });
});

test('category responses contain only the authenticated account rows', async (t) => {
  const members = db.select().from(users).all().filter(user => user.accountId && user.isActive).slice(0, 2);
  if (members.length < 2) return t.skip('requires two active fixture accounts');
  await withServer(async base => {
    for (const member of members) {
      const token = jwt.sign({ userId: member.id }, JWT_SECRET, { expiresIn: '1m' });
      const response = await fetch(`${base}/api/categories`, { headers: { cookie: `token=${token}` } });
      assert.equal(response.status, 200);
      const rows = await response.json();
      const ownedIds = new Set(db.select().from(categories).where(eq(categories.userId, member.accountId)).all().map(row => row.id));
      assert.equal(rows.every(row => ownedIds.has(row.id)), true);
      assert.equal(rows.length, ownedIds.size);
    }
  });
});

test('administrators promote privacy-neutral category names to defaults and customers remove only custom categories', async () => {
  const admin = db.select().from(users).all().find(user => user.accountId === 'test-admin-account');
  const first = db.select().from(users).all().find(user => user.accountId === 'test-member-one');
  const second = db.select().from(users).all().find(user => user.accountId === 'test-member-two');
  const name = `Shared test ${crypto.randomUUID().slice(0, 8)}`;
  db.insert(categories).values({ userId: first.accountId, name, color: '#123456' }).run();
  const token = user => jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1m' });
  await withServer(async base => {
    const adminHeaders = { cookie: `token=${token(admin)}`, 'content-type': 'application/json' };
    const library = await fetch(`${base}/api/admin/categories`, { headers: adminHeaders });
    const candidate = (await library.json()).candidates.find(item => item.name === name);
    assert.deepEqual(candidate, { name, color: '#123456' });
    assert.equal(Object.hasOwn(candidate, 'userId'), false);

    const promoted = await fetch(`${base}/api/admin/categories/defaults`, {
      method: 'POST', headers: adminHeaders, body: JSON.stringify(candidate),
    });
    assert.equal(promoted.status, 201);
    const promotedCategory = (await promoted.json()).category;

    const secondHeaders = { cookie: `token=${token(second)}` };
    const inherited = await fetch(`${base}/api/categories`, { headers: secondHeaders });
    assert.equal((await inherited.json()).find(item => item.name === name)?.isDefault, true);
    const protectedDelete = await fetch(`${base}/api/categories/${encodeURIComponent(name)}`, { method: 'DELETE', headers: secondHeaders });
    assert.equal(protectedDelete.status, 409);

    assert.equal((await fetch(`${base}/api/admin/categories/defaults/${promotedCategory.id}`, { method: 'DELETE', headers: adminHeaders })).status, 200);
    const customDelete = await fetch(`${base}/api/categories/${encodeURIComponent(name)}`, { method: 'DELETE', headers: secondHeaders });
    assert.equal(customDelete.status, 200);
  });
  db.delete(defaultCategories).where(eq(defaultCategories.normalizedName, name.toLocaleLowerCase())).run();
  for (const accountId of [admin.accountId, first.accountId, second.accountId]) {
    const row = db.select().from(categories).where(eq(categories.userId, accountId)).all().find(item => item.name === name);
    if (row) db.delete(categories).where(eq(categories.id, row.id)).run();
  }
});

test('non-admin sessions cannot access administrator operations', async (t) => {
  const member = db.select().from(users).all().find(user => user.accountId && user.isActive && user.role !== 'admin');
  if (!member) return t.skip('requires a non-admin fixture account');
  await withServer(async base => {
    const token = jwt.sign({ userId: member.id }, JWT_SECRET, { expiresIn: '1m' });
    for (const request of [
      { path: '/api/admin/simplefin-health', method: 'GET' },
      { path: '/api/admin/security-activity', method: 'GET' },
      { path: '/api/admin/categories', method: 'GET' },
      { path: '/api/admin/security-activity/not-an-event/unblock', method: 'POST' },
      { path: `/api/admin/users/${member.id}/simplefin/reset-sync-cooldown`, method: 'PATCH' },
    ]) {
      const response = await fetch(`${base}${request.path}`, { method: request.method, headers: { cookie: `token=${token}` } });
      assert.equal(response.status, 403, `${request.method} ${request.path}`);
    }
  });
});

test('administrators control account-scoped beta feature enrollment', async () => {
  const admin = db.select().from(users).all().find(user => user.accountId === 'test-admin-account');
  const member = db.select().from(users).all().find(user => user.accountId === 'test-member-one');
  const featureKey = 'purchase_data_inspector';
  db.delete(accountFeatureFlags).where(eq(accountFeatureFlags.accountId, member.accountId)).run();
  await withServer(async base => {
    const memberToken = jwt.sign({ userId: member.id }, JWT_SECRET, { expiresIn: '1m' });
    const adminToken = jwt.sign({ userId: admin.id }, JWT_SECRET, { expiresIn: '1m' });
    const betaUrl = `${base}/api/admin/users/${member.id}/beta-features/${featureKey}`;
    const denied = await fetch(betaUrl, {
      method: 'PATCH', headers: { cookie: `token=${memberToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    assert.equal(denied.status, 403);

    const enabled = await fetch(betaUrl, {
      method: 'PATCH', headers: { cookie: `token=${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    assert.equal(enabled.status, 200);
    assert.deepEqual((await enabled.json()).betaFeatures, [featureKey]);

    const customerView = await fetch(`${base}/api/spending/beta-features`, { headers: { cookie: `token=${memberToken}` } });
    assert.equal(customerView.status, 200);
    assert.deepEqual((await customerView.json()).features, [featureKey]);

    const disabled = await fetch(betaUrl, {
      method: 'PATCH', headers: { cookie: `token=${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }),
    });
    assert.equal(disabled.status, 200);
    assert.deepEqual((await disabled.json()).betaFeatures, []);
  });
});

test('financial write routes reject ownership fields and unsupported metadata', async (t) => {
  const member = db.select().from(users).all().find(user => user.accountId && user.isActive && user.role !== 'admin');
  if (!member) return t.skip('requires a non-admin fixture account');
  await withServer(async base => {
    const token = jwt.sign({ userId: member.id }, JWT_SECRET, { expiresIn: '1m' });
    const headers = { cookie: `token=${token}`, 'content-type': 'application/json' };
    const attempts = [
      { path: '/api/accounts/not-the-owner', method: 'PATCH', body: { name: 'Safe', accountId: 'someone-else' } },
      { path: '/api/profiles/me', method: 'PUT', body: { monthlyIncome: 100, userId: 'someone-else' } },
      { path: '/api/credit-cards', method: 'POST', body: { name: 'Card', institution: 'Bank', id: 'caller-selected-id' } },
    ];
    for (const attempt of attempts) {
      const response = await fetch(`${base}${attempt.path}`, { method: attempt.method, headers, body: JSON.stringify(attempt.body) });
      assert.equal(response.status, 400, `${attempt.method} ${attempt.path}`);
    }
  });
});

test('validated manual account inputs preserve legitimate values and server ownership', async (t) => {
  const member = db.select().from(users).all().find(user => user.accountId && user.isActive && user.role !== 'admin');
  if (!member) return t.skip('requires a non-admin fixture account');
  const marker = crypto.randomUUID();
  t.after(() => {
    for (const table of [creditCards, bankAccounts, tradingAccounts]) {
      for (const row of db.select().from(table).where(eq(table.userId, member.accountId)).all()) {
        if (row.name.includes(marker)) db.delete(table).where(eq(table.id, row.id)).run();
      }
    }
  });
  await withServer(async base => {
    const token = jwt.sign({ userId: member.id }, JWT_SECRET, { expiresIn: '1m' });
    const headers = { cookie: `token=${token}`, 'content-type': 'application/json' };
    for (const attempt of [
      { path: '/api/credit-cards', body: { name: `Card ${marker}`, institution: 'Example Bank', nickname: 'Daily card' } },
      { path: '/api/bank-accounts', body: { bankName: `Bank ${marker}`, balance: '123.45' } },
      { path: '/api/trading-accounts', body: { brokerName: `Broker ${marker}`, balance: 456.78 } },
    ]) {
      const response = await fetch(`${base}${attempt.path}`, { method: 'POST', headers, body: JSON.stringify(attempt.body) });
      assert.equal(response.status, 200, attempt.path);
    }
    const bank = db.select().from(bankAccounts).where(eq(bankAccounts.userId, member.accountId)).all().find(row => row.name.includes(marker));
    assert.match(bank.data, /^cdata\d+\./);
    assert.equal(JSON.parse(revealFinancialAccountData(sqlite, member.accountId, 'bank', bank.data)).balance, 123.45);
  });
});
