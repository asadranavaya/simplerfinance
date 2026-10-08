const crypto = require('crypto');
const { Router } = require('express');
const { and, eq } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const { splitPeople } = require('../db/schema');
const { encryptCustomerValue, decryptCustomerValue } = require('../lib/customerEncryption');
const { cleanText, hasOnlyKeys } = require('../middleware/inputValidation');

const router = Router();
const publicPerson = (accountId, row) => ({
  id: row.id,
  name: decryptCustomerValue(sqlite, accountId, 'split-person:name', row.encryptedName),
  createdAt: row.createdAt,
});

router.get('/', (req, res) => {
  const rows = db.select().from(splitPeople).where(eq(splitPeople.userId, req.user.accountId)).all();
  res.json(rows.map(row => publicPerson(req.user.accountId, row)).sort((a, b) => a.name.localeCompare(b.name)));
});

router.post('/', (req, res) => {
  if (!hasOnlyKeys(req.body, ['name'])) return res.status(400).json({ error: 'Unsupported person field.' });
  const name = cleanText(req.body?.name, { label: 'Name', max: 80, required: true });
  if (name.error) return res.status(400).json({ error: name.error });
  const accountId = req.user.accountId;
  const existing = db.select().from(splitPeople).where(eq(splitPeople.userId, accountId)).all()
    .map(row => publicPerson(accountId, row)).find(row => row.name.toLocaleLowerCase() === name.value.toLocaleLowerCase());
  if (existing) return res.status(409).json({ error: 'A person with that name already exists.' });
  const row = { id: crypto.randomUUID(), userId: accountId, encryptedName: encryptCustomerValue(sqlite, accountId, 'split-person:name', name.value), createdAt: new Date().toISOString() };
  db.insert(splitPeople).values(row).run();
  res.status(201).json(publicPerson(accountId, row));
});

router.delete('/:id', (req, res) => {
  const result = db.delete(splitPeople).where(and(eq(splitPeople.id, req.params.id), eq(splitPeople.userId, req.user.accountId))).run();
  if (!result.changes) return res.status(404).json({ error: 'Person not found.' });
  res.json({ deleted: true });
});

module.exports = router;
