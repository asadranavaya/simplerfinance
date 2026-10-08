const crypto = require('crypto');
const { Router } = require('express');
const { eq, and } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const { detectedSubscriptions, subscriptionLinks, excludedFromSubscriptions, expenses, monthlySpending } = require('../db/schema');
const { runSubscriptionDetection, deserializeSub } = require('../lib/subscriptionDetection');
const { reapplyTravelPlans } = require('../lib/travelPlans');
const { normalizeIconPattern } = require('../lib/iconResolver');
const { resolveSubscriptionIcon } = require('../lib/subscriptionIcons');
const { revealExpenseRecord } = require('../lib/customerDataFields');
const { normalizeExpenseCategories } = require('../lib/expenseCategories');

const router = Router();

function primaryCategoriesByDescription(userId) {
  const spendingRows = db.select().from(monthlySpending)
    .where(eq(monthlySpending.userId, userId)).all();
  const matches = [];
  for (const spending of spendingRows) {
    for (const stored of db.select().from(expenses).where(eq(expenses.spendingId, spending.id)).all()) {
      if (stored.hiddenAt) continue;
      const expense = revealExpenseRecord(sqlite, stored);
      let metadata = {};
      try { metadata = normalizeExpenseCategories(JSON.parse(expense.data || '{}')); } catch { metadata = normalizeExpenseCategories({}); }
      matches.push({
        description: normalizeIconPattern(expense.description),
        category: metadata.mainCategory || expense.category,
        date: expense.date || `${spending.year}-${String(spending.month).padStart(2, '0')}-01`,
      });
    }
  }
  matches.sort((left, right) => String(right.date).localeCompare(String(left.date)));
  const result = new Map();
  for (const match of matches) {
    if (match.description && match.category && !result.has(match.description)) result.set(match.description, match.category);
  }
  return result;
}

function withIcon(row, categoryLookup) {
  const subscription = deserializeSub(row);
  const icon = resolveSubscriptionIcon(subscription, categoryLookup);
  return { ...subscription, icon };
}

function withIcons(rows, userId) {
  const categoryLookup = primaryCategoriesByDescription(userId);
  return foldLinkedSubscriptions(rows, linksForUser(userId)).map(row => withIcon(row, categoryLookup));
}

function linksForUser(userId) {
  return db.select().from(subscriptionLinks).where(eq(subscriptionLinks.userId, userId)).all();
}

function foldLinkedSubscriptions(rows, links) {
  const byId = new Map(rows.map(row => [row.id, deserializeSub(row)]));
  const sourceIds = new Set(links.map(link => link.sourceSubscriptionId));
  const children = new Map();
  for (const link of links) {
    if (!byId.has(link.sourceSubscriptionId) || !byId.has(link.targetSubscriptionId)) continue;
    const group = children.get(link.targetSubscriptionId) || [];
    group.push(byId.get(link.sourceSubscriptionId));
    children.set(link.targetSubscriptionId, group);
  }
  return [...byId.values()].filter(row => !sourceIds.has(row.id)).map(target => {
    const linked = children.get(target.id) || [];
    if (!linked.length) return { ...target, linkedSubscriptions: [] };
    const members = [target, ...linked];
    const occurrences = members.reduce((sum, item) => sum + Number(item.occurrences || 0), 0);
    const totalPaid = members.reduce((sum, item) => sum + Number(item.totalPaid || 0), 0);
    const variants = [...new Set(members.flatMap(item => [item.description, ...(item.variants || [])]).filter(Boolean))];
    const dates = field => members.map(item => item[field]).filter(Boolean).sort();
    return {
      ...target,
      variants,
      averageAmount: occurrences ? Math.round((totalPaid / occurrences) * 100) / 100 : Number(target.averageAmount || 0),
      totalPaid: Math.round(totalPaid * 100) / 100,
      firstDetected: dates('firstDetected')[0] || null,
      lastPayment: dates('lastPayment').at(-1) || null,
      isActive: members.some(item => item.isActive),
      occurrences,
      consecutiveMonths: Math.max(...members.map(item => Number(item.consecutiveMonths || 0))),
      linkedSubscriptions: linked.map(item => ({ id: item.id, description: item.description })),
    };
  });
}

// GET /api/subscriptions
router.get('/', (req, res) => {
  const userId = req.user.accountId;
  const rows = db.select().from(detectedSubscriptions)
    .where(eq(detectedSubscriptions.userId, userId)).all();
  res.json(withIcons(rows, userId));
});

// POST /api/subscriptions/detect
router.post('/detect', (req, res) => {
  const userId = req.user.accountId;
  runSubscriptionDetection(userId);
  const result = withIcons(db.select().from(detectedSubscriptions).where(eq(detectedSubscriptions.userId, userId)).all(), userId);
  reapplyTravelPlans(userId);
  res.json(result);
});

router.post('/:targetId/link', (req, res) => {
  const userId = req.user.accountId;
  const sourceId = typeof req.body?.sourceId === 'string' ? req.body.sourceId.trim() : '';
  const targetId = String(req.params.targetId || '').trim();
  if (!sourceId || sourceId.length > 100 || !targetId || targetId.length > 100 || sourceId === targetId) {
    return res.status(400).json({ error: 'Choose two different subscriptions to link.' });
  }
  const ownedIds = new Set(db.select().from(detectedSubscriptions).where(eq(detectedSubscriptions.userId, userId)).all().map(row => row.id));
  if (!ownedIds.has(sourceId) || !ownedIds.has(targetId)) return res.status(404).json({ error: 'Subscription not found.' });
  const targetParent = db.select().from(subscriptionLinks).where(and(eq(subscriptionLinks.userId, userId), eq(subscriptionLinks.sourceSubscriptionId, targetId))).get();
  if (targetParent) return res.status(409).json({ error: 'Link to the visible parent subscription instead.' });

  sqlite.transaction(() => {
    db.delete(subscriptionLinks).where(and(eq(subscriptionLinks.userId, userId), eq(subscriptionLinks.sourceSubscriptionId, sourceId))).run();
    sqlite.prepare('UPDATE subscription_links SET target_subscription_id=? WHERE user_id=? AND target_subscription_id=?').run(targetId, userId, sourceId);
    db.insert(subscriptionLinks).values({ id: crypto.randomUUID(), userId, sourceSubscriptionId: sourceId, targetSubscriptionId: targetId, createdAt: new Date().toISOString() }).run();
  })();
  const rows = db.select().from(detectedSubscriptions).where(eq(detectedSubscriptions.userId, userId)).all();
  res.json(withIcons(rows, userId));
});

router.delete('/links/:sourceId', (req, res) => {
  const userId = req.user.accountId;
  const result = db.delete(subscriptionLinks).where(and(eq(subscriptionLinks.userId, userId), eq(subscriptionLinks.sourceSubscriptionId, req.params.sourceId))).run();
  if (!result.changes) return res.status(404).json({ error: 'Subscription link not found.' });
  const rows = db.select().from(detectedSubscriptions).where(eq(detectedSubscriptions.userId, userId)).all();
  res.json(withIcons(rows, userId));
});

// DELETE /api/subscriptions/:id
router.delete('/:id', (req, res) => {
  const userId = req.user.accountId;
  const sub = db.select().from(detectedSubscriptions)
    .where(and(eq(detectedSubscriptions.id, req.params.id), eq(detectedSubscriptions.userId, userId))).get();

  if (!sub) return res.json(false);

  const linkedRows = sqlite.prepare(`SELECT d.* FROM subscription_links l JOIN detected_subscriptions d ON d.id=l.source_subscription_id WHERE l.user_id=? AND l.target_subscription_id=?`).all(userId, sub.id);
  const exclusions = [...new Set([sub, ...linkedRows].flatMap(row => {
    let rowVariants = []; try { rowVariants = JSON.parse(row.variants || '[]'); } catch {}
    return [row.description, ...rowVariants];
  }).filter(Boolean))];

  for (const variant of exclusions) {
    const key = variant.trim().toLowerCase();
    const alreadyExcluded = db.select().from(excludedFromSubscriptions).where(
      and(
        eq(excludedFromSubscriptions.userId, userId),
        eq(excludedFromSubscriptions.description, key)
      )
    ).get();

    if (!alreadyExcluded) {
      db.insert(excludedFromSubscriptions).values({
        userId,
        description: key,
        originalDescription: variant,
        excludedAt: new Date().toISOString(),
      }).run();
    }
  }

  sqlite.transaction(() => {
    for (const linked of linkedRows) db.delete(detectedSubscriptions).where(eq(detectedSubscriptions.id, linked.id)).run();
    db.delete(detectedSubscriptions).where(eq(detectedSubscriptions.id, req.params.id)).run();
  })();
  reapplyTravelPlans(userId);
  res.json(true);
});

module.exports = router;
module.exports.foldLinkedSubscriptions = foldLinkedSubscriptions;
