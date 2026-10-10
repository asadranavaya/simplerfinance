const { Router } = require('express');
const { eq, and } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const { creditCards, bankAccounts, tradingAccounts } = require('../db/schema');
const { activeLink, simplefinProjection } = require('../lib/accountProjection');
const crypto = require('crypto');
const { cleanId, cleanNumber, cleanText, hasOnlyKeys } = require('../middleware/inputValidation');
const { createNotification } = require('../lib/notifications');
const { protectFinancialAccountData, revealFinancialAccountData } = require('../lib/customerDataFields');
const { resolveAccountIcon } = require('../lib/iconResolver');

const router = Router();
const accountTables = { credit_card: creditCards, bank: bankAccounts, trading: tradingAccounts };

// Account-scoped net-worth tracking preference. New and existing accounts
// default to included; this endpoint only stores an explicit opt-out.
router.patch('/financial-accounts/:type/:id/net-worth', (req, res) => {
  if (!hasOnlyKeys(req.body, ['included']) || typeof req.body.included !== 'boolean') {
    return res.status(400).json({ error: 'Net worth inclusion must be true or false.' });
  }
  const table = accountTables[req.params.type];
  if (!table) return res.status(400).json({ error: 'Choose a valid financial account type.' });
  const id = cleanId(req.params.id, 'Account identifier');
  if (id.error) return res.status(400).json({ error: id.error });
  const owned = and(eq(table.id, id.value), eq(table.userId, req.user.accountId));
  const existing = db.select().from(table).where(owned).get();
  if (!existing) return res.status(404).json({ error: 'Financial account not found.' });
  db.update(table).set({ includeInNetWorth: req.body.included }).where(owned).run();
  res.json(projectRow(db.select().from(table).where(owned).get(), req.params.type, req.user.accountId));
});

// Reversible close/reactivate operation shared by every financial account.
router.patch('/financial-accounts/:type/:id/status', (req, res) => {
  if (!hasOnlyKeys(req.body, ['isActive']) || typeof req.body.isActive !== 'boolean') {
    return res.status(400).json({ error: 'Account status must be active or closed.' });
  }
  const table = accountTables[req.params.type];
  if (!table) return res.status(400).json({ error: 'Choose a valid financial account type.' });
  const id = cleanId(req.params.id, 'Account identifier');
  if (id.error) return res.status(400).json({ error: id.error });
  const owned = and(eq(table.id, id.value), eq(table.userId, req.user.accountId));
  const existing = db.select().from(table).where(owned).get();
  if (!existing) return res.status(404).json({ error: 'Financial account not found.' });
  db.update(table).set({
    isActive: req.body.isActive,
    closedAt: req.body.isActive ? null : new Date().toISOString(),
  }).where(owned).run();
  const saved = db.select().from(table).where(owned).get();
  createNotification(req.user.accountId, {
    type: req.body.isActive ? 'success' : 'info',
    title: req.body.isActive ? 'Financial account reactivated' : 'Financial account closed',
    message: `${deserialize(saved).name || 'Financial account'} was ${req.body.isActive ? 'restored for future activity' : 'moved to closed accounts'}.`,
    metadata: { source: 'financial-account', accountType: req.params.type, accountId: saved.id },
  });
  res.json(projectRow(saved, req.params.type, req.user.accountId));
});

// ── Credit Cards ──────────────────────────────────────────────────────────────

// GET /api/credit-cards
router.get('/credit-cards', (req, res) => {
  const rows = db.select().from(creditCards).where(eq(creditCards.userId, req.user.accountId)).all();
  res.json(rows.map((row) => projectRow(row, 'credit_card', req.user.accountId)));
});

// POST /api/credit-cards
router.post('/credit-cards', (req, res) => {
  if (!hasOnlyKeys(req.body, ['name', 'institution', 'nickname', 'userId'])) return res.status(400).json({ error: 'Unsupported credit-card field.' });
  const name = cleanText(req.body.name, { label: 'Card name', max: 100, required: true });
  const institution = cleanText(req.body.institution, { label: 'Institution', max: 100, required: true });
  const nickname = cleanText(req.body.nickname, { label: 'Nickname', max: 100 });
  const error = name.error || institution.error || nickname.error;
  if (error) return res.status(400).json({ error });
  db.insert(creditCards).values({
    id: crypto.randomUUID(),
    userId: req.user.accountId,
    name: name.value,
    data: protectFinancialAccountData(sqlite, req.user.accountId, 'credit_card', JSON.stringify({ institution: institution.value, ...(nickname.value ? { nickname: nickname.value } : {}) })),
  }).run();
  const rows = db.select().from(creditCards).where(eq(creditCards.userId, req.user.accountId)).all();
  res.json(rows.map((row) => projectRow(row, 'credit_card', req.user.accountId)));
});

// GET /api/bank-accounts
router.get('/bank-accounts', (req, res) => {
  const rows = db.select().from(bankAccounts).where(eq(bankAccounts.userId, req.user.accountId)).all();
  res.json(rows.map((row) => projectRow(row, 'bank', req.user.accountId)));
});

// POST /api/bank-accounts
router.post('/bank-accounts', (req, res) => {
  if (!hasOnlyKeys(req.body, ['bankName', 'balance', 'updateId', 'userId'])) return res.status(400).json({ error: 'Unsupported bank-account field.' });
  const name = cleanText(req.body.bankName, { label: 'Bank name', max: 100, required: true });
  const balance = cleanNumber(req.body.balance, { label: 'Balance', required: true });
  if (name.error || balance.error) return res.status(400).json({ error: name.error || balance.error });
  const updateId = req.body.updateId ? cleanId(req.body.updateId, 'Account identifier') : { value: null };
  if (updateId.error) return res.status(400).json({ error: updateId.error });
  const data = { bankName: name.value, balance: balance.value };

  if (updateId.value) {
    // Verify ownership before updating
    const existing = db.select().from(bankAccounts)
      .where(and(eq(bankAccounts.id, updateId.value), eq(bankAccounts.userId, req.user.accountId)))
      .get();
    if (!existing) return res.status(403).json({ error: 'Forbidden' });

    db.update(bankAccounts)
      .set({ name: name.value, data: protectFinancialAccountData(sqlite, req.user.accountId, 'bank', JSON.stringify(data)) })
      .where(eq(bankAccounts.id, updateId.value))
      .run();
  } else {
    db.insert(bankAccounts).values({
      id: crypto.randomUUID(),
      userId: req.user.accountId,
      name: name.value,
      data: protectFinancialAccountData(sqlite, req.user.accountId, 'bank', JSON.stringify(data)),
    }).run();
  }

  const rows = db.select().from(bankAccounts).where(eq(bankAccounts.userId, req.user.accountId)).all();
  res.json(rows.map((row) => projectRow(row, 'bank', req.user.accountId)));
});

// DELETE /api/bank-accounts/:id
router.delete('/bank-accounts/:id', (req, res) => {
  const existing = db.select().from(bankAccounts)
    .where(and(eq(bankAccounts.id, req.params.id), eq(bankAccounts.userId, req.user.accountId)))
    .get();
  if (!existing) return res.status(403).json({ error: 'Forbidden' });
  if (activeLink(req.user.accountId, 'bank', existing.id)) {
    return res.status(409).json({ error: 'Unlink this SimpleFIN account before deleting the manual account.' });
  }

  db.delete(bankAccounts).where(eq(bankAccounts.id, req.params.id)).run();
  res.json(true);
});

// GET /api/trading-accounts
router.get('/trading-accounts', (req, res) => {
  const rows = db.select().from(tradingAccounts).where(eq(tradingAccounts.userId, req.user.accountId)).all();
  res.json(rows.map((row) => projectRow(row, 'trading', req.user.accountId)));
});

// POST /api/trading-accounts
router.post('/trading-accounts', (req, res) => {
  if (!hasOnlyKeys(req.body, ['brokerName', 'balance', 'updateId', 'userId'])) return res.status(400).json({ error: 'Unsupported trading-account field.' });
  const name = cleanText(req.body.brokerName, { label: 'Broker name', max: 100, required: true });
  const balance = cleanNumber(req.body.balance, { label: 'Balance', required: true });
  if (name.error || balance.error) return res.status(400).json({ error: name.error || balance.error });
  const updateId = req.body.updateId ? cleanId(req.body.updateId, 'Account identifier') : { value: null };
  if (updateId.error) return res.status(400).json({ error: updateId.error });
  const data = { brokerName: name.value, balance: balance.value };

  if (updateId.value) {
    // Verify ownership before updating
    const existing = db.select().from(tradingAccounts)
      .where(and(eq(tradingAccounts.id, updateId.value), eq(tradingAccounts.userId, req.user.accountId)))
      .get();
    if (!existing) return res.status(403).json({ error: 'Forbidden' });

    db.update(tradingAccounts)
      .set({ name: name.value, data: protectFinancialAccountData(sqlite, req.user.accountId, 'trading', JSON.stringify(data)) })
      .where(eq(tradingAccounts.id, updateId.value))
      .run();
  } else {
    db.insert(tradingAccounts).values({
      id: crypto.randomUUID(),
      userId: req.user.accountId,
      name: name.value,
      data: protectFinancialAccountData(sqlite, req.user.accountId, 'trading', JSON.stringify(data)),
    }).run();
  }

  const rows = db.select().from(tradingAccounts).where(eq(tradingAccounts.userId, req.user.accountId)).all();
  res.json(rows.map((row) => projectRow(row, 'trading', req.user.accountId)));
});

// DELETE /api/trading-accounts/:id
router.delete('/trading-accounts/:id', (req, res) => {
  const existing = db.select().from(tradingAccounts)
    .where(and(eq(tradingAccounts.id, req.params.id), eq(tradingAccounts.userId, req.user.accountId)))
    .get();
  if (!existing) return res.status(403).json({ error: 'Forbidden' });
  if (activeLink(req.user.accountId, 'trading', existing.id)) {
    return res.status(409).json({ error: 'Unlink this SimpleFIN account before deleting the manual account.' });
  }

  db.delete(tradingAccounts).where(eq(tradingAccounts.id, req.params.id)).run();
  res.json(true);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Merge the JSON data blob back into the row object
function deserialize(row, type, userId) {
  const { data, ...rest } = row;
  const plaintext = revealFinancialAccountData(sqlite, userId, type, data);
  return { ...rest, ...(plaintext ? JSON.parse(plaintext) : {}) };
}

function projectRow(row, type, userId) {
  const local = deserialize(row, type, userId);
  const simplefin = simplefinProjection(userId, type, row.id);
  return {
    ...local,
    icon: resolveAccountIcon({ product: local.name, institution: simplefin?.institutionName || local.institution || local.bankName || local.brokerName || local.name }),
    ...(simplefin?.balance != null ? { balance: simplefin.balance } : {}),
    balanceSource: simplefin ? 'simplefin' : 'manual',
    simplefin,
  };
}

module.exports = router;
