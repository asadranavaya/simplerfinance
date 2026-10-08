const { Router } = require('express');
const { eq } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const { financialProfiles, goals } = require('../db/schema');
const { validCurrency } = require('../lib/fxRates');
const crypto = require('crypto');
const { cleanNumber, cleanText, hasOnlyKeys, isIsoDate } = require('../middleware/inputValidation');
const { createNotification } = require('../lib/notifications');
const { captureMonthlySavingsTarget, getSavingsProgress } = require('../lib/savingsProgress');
const { protectGoalData, revealGoalData } = require('../lib/customerDataFields');

const router = Router();

// GET /api/profiles/me
router.get('/me', (req, res) => {
  const userId = req.user.accountId;
  const profile = db.select().from(financialProfiles)
    .where(eq(financialProfiles.userId, userId)).get();

  if (!profile) {
    return res.json({
      userId,
      monthlyIncome: 0, yearlyIncome: 0, percentToSave: 0, percentToContribute: 0,
      monthlySavingTarget: 0, monthlySpendLimit: 0, yearlyIncomeAfterTax: 0,
      goals: [], budgetCategories: [],
      reportingCurrency: 'USD',
      savingsProgress: { year: new Date().getUTCFullYear(), targetAmount: 0, amountSaved: 0, months: [] },
    });
  }

  captureMonthlySavingsTarget(userId, profile);

  const userGoals = db.select().from(goals).where(eq(goals.userId, userId)).all()
    .map(g => ({ id: g.id, ...JSON.parse(revealGoalData(sqlite, userId, g.data) || '{}') }));

  res.json({
    userId,
    monthlyIncome: profile.monthlyIncome,
    yearlyIncome: profile.yearlyIncome,
    percentToSave: profile.percentToSave,
    percentToContribute: profile.percentToContribute,
    monthlySavingTarget: profile.monthlySavingTarget,
    monthlySpendLimit: profile.monthlySpendLimit,
    yearlyIncomeAfterTax: profile.yearlyIncomeAfterTax,
    budgetCategories: JSON.parse(profile.budgetCategories || '[]'),
    reportingCurrency: profile.reportingCurrency || 'USD',
    goals: userGoals,
    savingsProgress: getSavingsProgress(userId),
  });
});

// PUT /api/profiles/me
router.put('/me', (req, res) => {
  const userId = req.user.accountId;
  const body = req.body;
  const allowedProfileFields = ['monthlyIncome', 'yearlyIncome', 'percentToSave', 'percentToContribute', 'monthlySavingTarget', 'monthlySpendLimit', 'yearlyIncomeAfterTax', 'budgetCategories', 'reportingCurrency', 'goals'];
  if (!hasOnlyKeys(body, allowedProfileFields)) return res.status(400).json({ error: 'Unsupported financial-profile field.' });
  const moneyFields = ['monthlyIncome', 'yearlyIncome', 'monthlySavingTarget', 'monthlySpendLimit', 'yearlyIncomeAfterTax'];
  const validated = {};
  for (const field of moneyFields) {
    if (body[field] == null) continue;
    const result = cleanNumber(body[field], { label: field, min: 0, max: 1e15, required: true });
    if (result.error) return res.status(400).json({ error: result.error });
    validated[field] = result.value;
  }
  for (const field of ['percentToSave', 'percentToContribute']) {
    if (body[field] == null) continue;
    const result = cleanNumber(body[field], { label: field, min: 0, max: 100, required: true });
    if (result.error) return res.status(400).json({ error: result.error });
    validated[field] = result.value;
  }
  if (body.budgetCategories != null && (!Array.isArray(body.budgetCategories) || body.budgetCategories.length > 100 || JSON.stringify(body.budgetCategories).length > 10_000)) {
    return res.status(400).json({ error: 'Budget categories must be a list of at most 100 items.' });
  }
  const monthlyIncome = validated.monthlyIncome;
  const budgetCategories = body.budgetCategories;
  const yearlyIncome = validated.yearlyIncome;
  const percentToSave = validated.percentToSave;
  const percentToContribute = validated.percentToContribute;
  const monthlySavingTarget = validated.monthlySavingTarget;
  const monthlySpendLimit = validated.monthlySpendLimit;
  const yearlyIncomeAfterTax = validated.yearlyIncomeAfterTax;
  const reportingCurrency = body.reportingCurrency == null ? null : validCurrency(body.reportingCurrency);
  if (body.reportingCurrency != null && !reportingCurrency) return res.status(400).json({ error: 'Choose a valid three-letter reporting currency.' });

  const existing = db.select().from(financialProfiles)
    .where(eq(financialProfiles.userId, userId)).get();

  if (existing) {
    db.update(financialProfiles).set({
      monthlyIncome: monthlyIncome ?? existing.monthlyIncome,
      yearlyIncome: yearlyIncome ?? existing.yearlyIncome,
      percentToSave: percentToSave ?? existing.percentToSave,
      percentToContribute: percentToContribute ?? existing.percentToContribute,
      monthlySavingTarget: monthlySavingTarget ?? existing.monthlySavingTarget,
      monthlySpendLimit: monthlySpendLimit ?? existing.monthlySpendLimit,
      yearlyIncomeAfterTax: yearlyIncomeAfterTax ?? existing.yearlyIncomeAfterTax,
      budgetCategories: JSON.stringify(budgetCategories ?? JSON.parse(existing.budgetCategories || '[]')),
      reportingCurrency: reportingCurrency || existing.reportingCurrency || 'USD',
    }).where(eq(financialProfiles.userId, userId)).run();
  } else {
    db.insert(financialProfiles).values({
      userId,
      monthlyIncome: monthlyIncome ?? 0,
      yearlyIncome: yearlyIncome ?? 0,
      percentToSave: percentToSave ?? 0,
      percentToContribute: percentToContribute ?? 0,
      monthlySavingTarget: monthlySavingTarget ?? 0,
      monthlySpendLimit: monthlySpendLimit ?? 0,
      yearlyIncomeAfterTax: yearlyIncomeAfterTax ?? 0,
      budgetCategories: JSON.stringify(budgetCategories ?? []),
      reportingCurrency: reportingCurrency || 'USD',
    }).run();
  }

  const profile = db.select().from(financialProfiles)
    .where(eq(financialProfiles.userId, userId)).get();
  const userGoals = db.select().from(goals).where(eq(goals.userId, userId)).all()
    .map(g => ({ id: g.id, ...JSON.parse(revealGoalData(sqlite, userId, g.data) || '{}') }));

  captureMonthlySavingsTarget(userId, profile);

  createNotification(userId, {
    type: 'success',
    title: 'Financial profile updated',
    message: 'Your income, savings, or spending preferences were updated.',
    metadata: { source: 'financial-profile' },
  });

  res.json({
    userId,
    monthlyIncome: profile.monthlyIncome,
    yearlyIncome: profile.yearlyIncome,
    percentToSave: profile.percentToSave,
    percentToContribute: profile.percentToContribute,
    monthlySavingTarget: profile.monthlySavingTarget,
    monthlySpendLimit: profile.monthlySpendLimit,
    yearlyIncomeAfterTax: profile.yearlyIncomeAfterTax,
    budgetCategories: JSON.parse(profile.budgetCategories || '[]'),
    reportingCurrency: profile.reportingCurrency || 'USD',
    goals: userGoals,
    savingsProgress: getSavingsProgress(userId),
  });
});

// POST /api/profiles/me/goals
router.post('/me/goals', (req, res) => {
  const userId = req.user.accountId;
  const validation = validateGoal(req.body);
  if (validation.error) return res.status(400).json({ error: validation.error });
  const goalData = validation.value;
  const id = `goal_${crypto.randomUUID()}`;

  db.insert(goals).values({
    id,
    userId,
    name: goalData.name || 'Goal',
    data: protectGoalData(sqlite, userId, JSON.stringify(goalData)),
  }).run();

  res.json({ id, ...goalData });
});

// PATCH /api/profiles/me/goals/:goalId
router.patch('/me/goals/:goalId', (req, res) => {
  const { goalId } = req.params;
  const userId = req.user.accountId;

  const existing = db.select().from(goals).where(eq(goals.id, goalId)).get();
  if (!existing) return res.json(null);
  if (existing.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

  const validation = validateGoal({ ...JSON.parse(revealGoalData(sqlite, userId, existing.data) || '{}'), ...req.body });
  if (validation.error) return res.status(400).json({ error: validation.error });
  const merged = validation.value;
  db.update(goals).set({
    name: merged.name || existing.name,
    data: protectGoalData(sqlite, userId, JSON.stringify(merged)),
  }).where(eq(goals.id, goalId)).run();

  res.json({ id: goalId, ...merged });
});

function validateGoal(value) {
  if (!hasOnlyKeys(value, ['name', 'targetAmount', 'currentAmount', 'targetDate'])) return { error: 'Unsupported goal field.' };
  const name = cleanText(value.name, { label: 'Goal name', max: 100, required: true });
  const target = cleanNumber(value.targetAmount, { label: 'Target amount', min: 0, max: 1e15, required: true });
  const current = cleanNumber(value.currentAmount ?? 0, { label: 'Current amount', min: 0, max: 1e15, required: true });
  if (name.error || target.error || current.error) return { error: name.error || target.error || current.error };
  if (value.targetDate && !isIsoDate(value.targetDate)) return { error: 'Target date must be a valid YYYY-MM-DD date.' };
  return { value: { name: name.value, targetAmount: target.value, currentAmount: current.value, ...(value.targetDate ? { targetDate: value.targetDate } : {}) } };
}

// DELETE /api/profiles/me/goals/:goalId
router.delete('/me/goals/:goalId', (req, res) => {
  const userId = req.user.accountId;

  const existing = db.select().from(goals).where(eq(goals.id, req.params.goalId)).get();
  if (!existing) return res.json(true); // already gone, idempotent
  if (existing.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

  db.delete(goals).where(eq(goals.id, req.params.goalId)).run();
  res.json(true);
});

module.exports = router;
