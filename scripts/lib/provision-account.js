const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { eq } = require('drizzle-orm');
const { validateAccountName } = require('../../server/lib/accountName');

function validateIdentity({ email: rawEmail, password, name, role = 'user' }) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Use a valid email address no longer than 254 characters.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Use a password between 12 and 128 characters.');
  if (!['user', 'admin'].includes(role)) throw new Error('Role must be user or admin.');
  const validatedName = validateAccountName(name || (role === 'admin' ? 'Administrator' : 'Budget User'));
  if (validatedName.error) throw new Error(validatedName.error);
  return { email, password, name: validatedName.name, role };
}

async function provisionAccount(input, { updateExisting = false } = {}) {
  const values = validateIdentity(input);
  const { db, sqlite } = require('../../server/db');
  const { users, accounts } = require('../../server/db/schema');
  const existing = db.select().from(users).where(eq(users.email, values.email)).get();
  const passwordHash = await bcrypt.hash(values.password, 12);
  const verifiedAt = new Date().toISOString();

  if (existing) {
    if (!updateExisting) throw new Error('A login with that email already exists.');
    sqlite.transaction(() => {
      db.update(users).set({ passwordHash, role: values.role, isActive: true, emailVerifiedAt: verifiedAt, sessionVersion: (existing.sessionVersion || 0) + 1 })
        .where(eq(users.id, existing.id)).run();
      if (existing.accountId) db.update(accounts).set({ name: values.name }).where(eq(accounts.id, existing.accountId)).run();
    })();
    return { created: false, email: values.email, role: values.role, accountId: existing.accountId };
  }

  const accountId = `${values.role}-${crypto.randomUUID()}`;
  sqlite.transaction(() => {
    db.insert(accounts).values({ id: accountId, name: values.name, avatar: null }).run();
    db.insert(users).values({ email: values.email, passwordHash, accountId, createdAt: verifiedAt, emailVerifiedAt: verifiedAt, role: values.role, isActive: true }).run();
  })();
  return { created: true, email: values.email, role: values.role, accountId };
}

module.exports = { provisionAccount, validateIdentity };
