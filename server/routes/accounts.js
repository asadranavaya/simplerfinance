const { Router } = require('express');
const { eq } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const { accounts } = require('../db/schema');
const { validateAccountName } = require('../lib/accountName');
const { cleanText, hasOnlyKeys } = require('../middleware/inputValidation');
const { createNotification } = require('../lib/notifications');

const router = Router();

// GET /api/accounts
router.get('/', (req, res) => {
  const row = db.select().from(accounts).where(eq(accounts.id, req.user.accountId)).get();
  res.json(row ? [row] : []);
});

// POST /api/accounts  (update own account name/avatar)
router.post('/', (req, res) => {
  if (!hasOnlyKeys(req.body, ['name', 'avatar'])) return res.status(400).json({ error: 'Unsupported account field.' });
  const validatedName = validateAccountName(req.body.name);
  if (validatedName.error) return res.status(400).json({ error: validatedName.error });
  let avatar = null;
  if (req.body.avatar) {
    const validatedAvatar = cleanText(req.body.avatar, { label: 'Avatar URL', max: 500, required: true });
    if (validatedAvatar.error || !/^https:\/\//i.test(validatedAvatar.value)) return res.status(400).json({ error: validatedAvatar.error || 'Avatar URL must use HTTPS.' });
    avatar = validatedAvatar.value;
  }
  const account = { name: validatedName.name, avatar, id: req.user.accountId };
  db.insert(accounts).values(account).run();
  const row = db.select().from(accounts).where(eq(accounts.id, req.user.accountId)).get();
  res.json([row]);
});

// PATCH /api/accounts/:id
router.patch('/:id', (req, res) => {
  if (!hasOnlyKeys(req.body, ['name', 'avatar']) || !Object.keys(req.body).length) {
    return res.status(400).json({ error: 'Provide a supported account field.' });
  }
  const updates = { ...req.body };
  if (Object.hasOwn(updates, 'name')) {
    const validatedName = validateAccountName(updates.name);
    if (validatedName.error) return res.status(400).json({ error: validatedName.error });
    updates.name = validatedName.name;
  }
  if (Object.hasOwn(updates, 'avatar')) {
    if (updates.avatar === null || updates.avatar === '') updates.avatar = null;
    else {
      const avatar = cleanText(updates.avatar, { label: 'Avatar URL', max: 500, required: true });
      if (avatar.error || !/^https:\/\//i.test(avatar.value)) return res.status(400).json({ error: avatar.error || 'Avatar URL must use HTTPS.' });
      updates.avatar = avatar.value;
    }
  }
  db.update(accounts).set(updates).where(eq(accounts.id, req.user.accountId)).run();
  const row = db.select().from(accounts).where(eq(accounts.id, req.user.accountId)).get();
  createNotification(req.user.accountId, {
    type: 'success',
    title: 'Account updated',
    message: Object.hasOwn(updates, 'name') ? `Your display name was changed to ${updates.name}.` : 'Your account profile was updated.',
    metadata: { source: 'account' },
  });
  res.json(row || null);
});

// DELETE /api/accounts/:id
router.delete('/:id', (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(403).json({ error: 'Administrator accounts cannot be deleted' });
  }
  db.delete(accounts).where(eq(accounts.id, req.user.accountId)).run();
  res.json(true);
});

module.exports = router;
