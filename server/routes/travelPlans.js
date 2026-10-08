const crypto = require('crypto');
const { Router } = require('express');
const { and, eq } = require('drizzle-orm');
const { db } = require('../db');
const { travelPlans, categories } = require('../db/schema');
const { cleanText, hasOnlyKeys, isIsoDate } = require('../middleware/inputValidation');
const { ownedTravelPlans, protectedTravelPlan, publicTravelPlan, travelPreferenceCategoryIds, saveTravelPreferenceCategoryIds, reapplyTravelPlans } = require('../lib/travelPlans');

const router = Router();

function validate(body) {
  if (!hasOnlyKeys(body, ['name', 'startDate', 'endDate'])) return { error: 'Unsupported travel plan field.' };
  const name = cleanText(body?.name, { label: 'Trip name', max: 80, required: true });
  if (name.error) return name;
  if (name.value.toLocaleLowerCase() === 'uncategorized') return { error: 'Choose a more specific trip name.' };
  if (!isIsoDate(body?.startDate) || !isIsoDate(body?.endDate)) return { error: 'Enter valid start and end dates.' };
  if (body.endDate < body.startDate) return { error: 'The end date cannot be before the start date.' };
  return { value: { name: name.value, startDate: body.startDate, endDate: body.endDate } };
}

router.get('/', (req, res) => res.json(ownedTravelPlans(req.user.accountId).sort((a, b) => b.startDate.localeCompare(a.startDate))));

router.get('/preferences', (req, res) => res.json({ excludedCategoryIds: travelPreferenceCategoryIds(req.user.accountId) }));

router.put('/preferences', (req, res) => {
  const userId = req.user.accountId;
  if (!hasOnlyKeys(req.body, ['excludedCategoryIds']) || !Array.isArray(req.body?.excludedCategoryIds) || req.body.excludedCategoryIds.length > 100) {
    return res.status(400).json({ error: 'Choose at most 100 excluded categories.' });
  }
  const ids = [...new Set(req.body.excludedCategoryIds)];
  if (ids.some(id => !Number.isInteger(id))) return res.status(400).json({ error: 'An excluded category is invalid.' });
  const ownedIds = new Set(db.select().from(categories).where(eq(categories.userId, userId)).all().map(category => category.id));
  if (ids.some(id => !ownedIds.has(id))) return res.status(400).json({ error: 'Choose categories belonging to your account.' });
  saveTravelPreferenceCategoryIds(userId, ids);
  const taggedExpenses = reapplyTravelPlans(userId);
  res.json({ excludedCategoryIds: ids, taggedExpenses });
});

router.post('/', (req, res) => {
  const userId = req.user.accountId;
  const validated = validate(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const current = ownedTravelPlans(userId);
  if (current.length >= 50) return res.status(409).json({ error: 'You can save up to 50 trips.' });
  if (current.some(plan => plan.name.toLocaleLowerCase() === validated.value.name.toLocaleLowerCase())) return res.status(409).json({ error: 'A trip with that name already exists.' });
  const now = new Date().toISOString();
  const row = { id: crypto.randomUUID(), userId, ...protectedTravelPlan(userId, validated.value), createdAt: now, updatedAt: now };
  db.insert(travelPlans).values(row).run();
  const taggedExpenses = reapplyTravelPlans(userId);
  res.status(201).json({ plan: publicTravelPlan(userId, row), taggedExpenses });
});

router.put('/:id', (req, res) => {
  const userId = req.user.accountId;
  const existing = db.select().from(travelPlans).where(and(eq(travelPlans.id, req.params.id), eq(travelPlans.userId, userId))).get();
  if (!existing) return res.status(404).json({ error: 'Trip not found.' });
  const validated = validate(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  if (ownedTravelPlans(userId).some(plan => plan.id !== existing.id && plan.name.toLocaleLowerCase() === validated.value.name.toLocaleLowerCase())) return res.status(409).json({ error: 'A trip with that name already exists.' });
  const values = { ...protectedTravelPlan(userId, validated.value), updatedAt: new Date().toISOString() };
  db.update(travelPlans).set(values).where(eq(travelPlans.id, existing.id)).run();
  const taggedExpenses = reapplyTravelPlans(userId);
  res.json({ plan: publicTravelPlan(userId, { ...existing, ...values }), taggedExpenses });
});

router.delete('/:id', (req, res) => {
  const userId = req.user.accountId;
  const result = db.delete(travelPlans).where(and(eq(travelPlans.id, req.params.id), eq(travelPlans.userId, userId))).run();
  if (!result.changes) return res.status(404).json({ error: 'Trip not found.' });
  reapplyTravelPlans(userId);
  res.json({ deleted: true });
});

module.exports = router;
