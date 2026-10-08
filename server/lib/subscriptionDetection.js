const { eq, and } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const { revealExpenseRecord } = require('./customerDataFields');
const { customerPaidAmount } = require('./expenseAmounts');
const {
  monthlySpending, expenses,
  detectedSubscriptions, subscriptionLinks, excludedFromSubscriptions,
} = require('../db/schema');

const SUBSCRIPTION_AMOUNT_VARIANCE = 3;

function calculateSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s1 === s2) return 1.0;
  if (!s1.length || !s2.length) return 0.0;

  const matrix = Array(s2.length + 1).fill(null).map(() => Array(s1.length + 1).fill(0));
  for (let i = 0; i <= s1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= s2.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= s2.length; j++) {
    for (let i = 1; i <= s1.length; i++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j - 1][i] + 1,
        matrix[j][i - 1] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  return (Math.max(s1.length, s2.length) - matrix[s2.length][s1.length]) / Math.max(s1.length, s2.length);
}

function getBestRepresentativeName(names) {
  const freq = {};
  names.forEach(n => { freq[n] = (freq[n] || 0) + 1; });
  return [...names].sort((a, b) => {
    const d = freq[b] - freq[a];
    if (d !== 0) return d;
    return (b.includes(' ') ? 1 : 0) - (a.includes(' ') ? 1 : 0);
  })[0];
}

function expenseDate(expense) {
  const fallback = `${expense.year}-${String(expense.month).padStart(2, '0')}-01`;
  const value = typeof expense.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expense.date) ? expense.date : fallback;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? fallback : value;
}

function monthIndex(expense) {
  return Number(expense.year) * 12 + Number(expense.month);
}

function stableMonthlySequence(expenses, variance = SUBSCRIPTION_AMOUNT_VARIANCE) {
  const ordered = [...expenses].sort((left, right) => expenseDate(left).localeCompare(expenseDate(right)));
  const chains = ordered.map(expense => ({ items: [expense] }));
  let best = chains[0]?.items || [];
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    let predecessor = null;
    for (let prior = 0; prior < index; prior += 1) {
      const candidate = ordered[prior];
      if (monthIndex(current) !== monthIndex(candidate) + 1) continue;
      const currentAmount = Number(current.amount);
      const candidateAmount = Number(candidate.amount);
      if (!Number.isFinite(currentAmount) || !Number.isFinite(candidateAmount)) continue;
      if (Math.abs(currentAmount - candidateAmount) > variance) continue;
      if (!predecessor || chains[prior].items.length > predecessor.items.length) predecessor = chains[prior];
    }
    if (predecessor) chains[index].items = [...predecessor.items, current];
    if (chains[index].items.length >= best.length) best = chains[index].items;
  }
  return best;
}

function longestConsecutiveMonthCount(items) {
  const months = [...new Set(items.map(monthIndex))].sort((left, right) => left - right);
  let best = 0;
  let current = 0;
  let previous = null;
  for (const month of months) {
    current = previous !== null && month === previous + 1 ? current + 1 : 1;
    best = Math.max(best, current);
    previous = month;
  }
  return best;
}

function manualMonthlySequence(items, referenceAmount) {
  const byMonth = new Map();
  for (const item of items) {
    const key = monthIndex(item);
    const existing = byMonth.get(key);
    if (!existing || Math.abs(Number(item.amount) - referenceAmount) < Math.abs(Number(existing.amount) - referenceAmount)) byMonth.set(key, item);
  }
  return [...byMonth.values()].sort((left, right) => expenseDate(left).localeCompare(expenseDate(right)));
}

function recurringMonthlyHistory(items, variance = SUBSCRIPTION_AMOUNT_VARIANCE) {
  const seed = stableMonthlySequence(items, variance);
  if (seed.length < 3) return null;
  const referenceAmount = seed.reduce((sum, item) => sum + Number(item.amount || 0), 0) / seed.length;
  const compatible = items.filter(item => Math.abs(Number(item.amount) - referenceAmount) <= variance);
  const history = manualMonthlySequence(compatible, referenceAmount);
  const consecutiveMonths = stableMonthlySequence(history, variance).length;
  return consecutiveMonths >= 3 ? { history, consecutiveMonths } : null;
}

function runSubscriptionDetection(userId) {
  // Load all spending + expenses for the user
  const spendingRecords = db.select().from(monthlySpending)
    .where(eq(monthlySpending.userId, userId)).all();

  const excluded = db.select().from(excludedFromSubscriptions)
    .where(eq(excludedFromSubscriptions.userId, userId)).all()
    .map(e => e.description);

  const expenseGroups = {};

  for (const record of spendingRecords) {
    const exps = db.select().from(expenses)
      .where(eq(expenses.spendingId, record.id)).all().filter(expense => !expense.hiddenAt);

    for (const stored of exps) {
      const exp = revealExpenseRecord(sqlite, stored);
      let metadata = {}; try { metadata = JSON.parse(exp.data || '{}'); } catch {}
      exp.amount = customerPaidAmount(exp.amount, metadata.split);
      const key = exp.description.trim().toLowerCase();
      if (excluded.includes(key)) continue;
      if (!expenseGroups[key]) expenseGroups[key] = [];
      expenseGroups[key].push({ ...exp, year: record.year, month: record.month, cardId: record.cardId });
    }
  }

  // Merge similar descriptions
  const processedKeys = new Set();
  const mergedGroups = {};

  for (const key1 of Object.keys(expenseGroups)) {
    if (processedKeys.has(key1)) continue;
    const similarKeys = [key1];
    processedKeys.add(key1);

    for (const key2 of Object.keys(expenseGroups)) {
      if (key1 !== key2 && !processedKeys.has(key2) && calculateSimilarity(key1, key2) >= 0.8) {
        similarKeys.push(key2);
        processedKeys.add(key2);
      }
    }

    const merged = [];
    const allNames = [];
    for (const k of similarKeys) {
      merged.push(...expenseGroups[k]);
      for (const e of expenseGroups[k]) {
        if (!allNames.includes(e.description)) allNames.push(e.description);
      }
    }
    mergedGroups[getBestRepresentativeName(allNames)] = merged;
  }

  // Detect recurring patterns
  const detectedSubs = [];

  for (const [description, exps] of Object.entries(mergedGroups)) {
    if (exps.length < 3) continue;

    const recurring = recurringMonthlyHistory(exps);
    if (!recurring) continue;
    const stableExps = recurring.history;
    const firstDate = stableExps[0];
    const lastDate = stableExps[stableExps.length - 1];
    const avgAmount = stableExps.reduce((s, e) => s + e.amount, 0) / stableExps.length;
    const totalPaid  = stableExps.reduce((s, e) => s + e.amount, 0);
    const now = new Date();
    const isActive = (now.getFullYear() * 12 + now.getMonth() + 1) - (lastDate.year * 12 + lastDate.month) <= 2;
    const variants = [...new Set(stableExps.map(e => e.description))];

    const sub = {
      id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      userId,
      description,
      variants: JSON.stringify(variants),
      averageAmount: Math.round(avgAmount * 100) / 100,
      totalPaid:     Math.round(totalPaid  * 100) / 100,
      firstDetected: expenseDate(firstDate),
      lastPayment:   expenseDate(lastDate),
      isActive,
      occurrences:       stableExps.length,
      consecutiveMonths: recurring.consecutiveMonths,
    };

    // Upsert: update if description already exists for user, otherwise insert
    const existing = db.select().from(detectedSubscriptions).where(
      and(
        eq(detectedSubscriptions.userId, userId),
        eq(detectedSubscriptions.description, description)
      )
    ).get();

    if (existing) {
      const { id: _generatedId, userId: _owner, ...updates } = sub;
      db.update(detectedSubscriptions).set(updates)
        .where(eq(detectedSubscriptions.id, existing.id)).run();
      sub.id = existing.id;
    } else {
      db.insert(detectedSubscriptions).values(sub).run();
    }

    detectedSubs.push(deserializeSub(sub));
  }

  const detectedIds = new Set(detectedSubs.map(subscription => subscription.id));
  const previousDetections = db.select().from(detectedSubscriptions)
    .where(eq(detectedSubscriptions.userId, userId)).all();
  const manualLinks = db.select().from(subscriptionLinks)
    .where(eq(subscriptionLinks.userId, userId)).all();
  const previousById = new Map(previousDetections.map(subscription => [subscription.id, subscription]));
  for (const link of manualLinks) {
    if (detectedIds.has(link.sourceSubscriptionId)) continue;
    const source = previousById.get(link.sourceSubscriptionId);
    if (!source) continue;
    const sourceVariants = deserializeSub(source).variants;
    const descriptions = new Set([source.description, ...sourceVariants].map(value => String(value).trim().toLowerCase()).filter(Boolean));
    const matching = [...descriptions].flatMap(description => expenseGroups[description] || []);
    const selected = manualMonthlySequence(matching, Number(source.averageAmount || 0));
    if (!selected.length) continue;
    const totalPaid = selected.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const last = selected.at(-1);
    const now = new Date();
    const isActive = (now.getFullYear() * 12 + now.getMonth() + 1) - (Number(last.year) * 12 + Number(last.month)) <= 2;
    const updates = {
      variants: JSON.stringify([...new Set([...sourceVariants, ...selected.map(expense => expense.description)])]),
      averageAmount: Math.round((totalPaid / selected.length) * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      firstDetected: expenseDate(selected[0]),
      lastPayment: expenseDate(last),
      isActive,
      occurrences: selected.length,
      consecutiveMonths: longestConsecutiveMonthCount(selected),
    };
    db.update(detectedSubscriptions).set(updates).where(eq(detectedSubscriptions.id, source.id)).run();
    detectedIds.add(source.id);
  }
  const manuallyLinkedIds = new Set(manualLinks.flatMap(link => [link.sourceSubscriptionId, link.targetSubscriptionId]));
  for (const previous of previousDetections) {
    if (!detectedIds.has(previous.id)) {
      if (manuallyLinkedIds.has(previous.id)) {
        db.update(detectedSubscriptions).set({ isActive: false })
          .where(eq(detectedSubscriptions.id, previous.id)).run();
      } else {
        db.delete(detectedSubscriptions).where(eq(detectedSubscriptions.id, previous.id)).run();
      }
    }
  }

  return detectedSubs;
}

function deserializeSub(row) {
  return {
    ...row,
    variants: typeof row.variants === 'string' ? JSON.parse(row.variants) : row.variants,
    isActive: Boolean(row.isActive),
  };
}

module.exports = { SUBSCRIPTION_AMOUNT_VARIANCE, runSubscriptionDetection, deserializeSub, expenseDate, stableMonthlySequence, manualMonthlySequence, recurringMonthlyHistory };
