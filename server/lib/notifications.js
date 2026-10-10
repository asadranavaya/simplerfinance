const crypto = require('crypto');
const { sqlite, db } = require('../db');
const { expenses } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { protectNotificationMetadata, revealNotificationMetadata, revealExpenseRecord } = require('./customerDataFields');

const subscribers = new Map();
const VALID_TYPES = new Set(['info', 'success', 'warning', 'security']);

function serializeNotification(row) {
  let metadata = {};
  try { metadata = JSON.parse(revealNotificationMetadata(sqlite, row.account_id, row.metadata) || '{}'); } catch (_) { /* Invalid legacy metadata stays empty. */ }
  let message = row.message;
  if (row.title === 'Purchase reminder' && typeof metadata.expenseId === 'string') {
    const owned = sqlite.prepare(`SELECT e.id FROM expenses e JOIN monthly_spending s ON s.id=e.spending_id
      WHERE e.id=? AND s.user_id=? AND e.hidden_at IS NULL`).get(metadata.expenseId, row.account_id);
    if (owned) {
      const purchase = revealExpenseRecord(sqlite, db.select().from(expenses).where(eq(expenses.id, owned.id)).get());
      const notes = JSON.parse(purchase.data || '{}').notes;
      if (typeof notes === 'string' && notes.trim()) message = notes;
    }
  }
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message,
    metadata,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

function publish(accountId, event, payload) {
  const accountSubscribers = subscribers.get(accountId);
  if (!accountSubscribers) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const response of accountSubscribers) response.write(frame);
}

function createNotification(accountId, { type = 'info', title, message, metadata = {} }) {
  if (!accountId || !title || !message) return null;
  const row = {
    id: `notification_${crypto.randomUUID()}`,
    account_id: accountId,
    type: VALID_TYPES.has(type) ? type : 'info',
    title: String(title).trim().slice(0, 120),
    message: String(message).trim().slice(0, 600),
    metadata: protectNotificationMetadata(sqlite, accountId, JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}).slice(0, 2000)),
    created_at: new Date().toISOString(),
    read_at: null,
  };
  sqlite.prepare(`
    INSERT INTO notifications (id, account_id, type, title, message, metadata, created_at, read_at)
    VALUES (@id, @account_id, @type, @title, @message, @metadata, @created_at, @read_at)
  `).run(row);
  const notification = serializeNotification(row);
  publish(accountId, 'notification', notification);
  return notification;
}

function subscribe(accountId, response) {
  const accountSubscribers = subscribers.get(accountId) || new Set();
  accountSubscribers.add(response);
  subscribers.set(accountId, accountSubscribers);
  return () => {
    accountSubscribers.delete(response);
    if (!accountSubscribers.size) subscribers.delete(accountId);
  };
}

module.exports = { createNotification, serializeNotification, subscribe };
