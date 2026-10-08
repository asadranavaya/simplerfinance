const crypto = require('crypto');
const { sqlite } = require('../db');
const { protectNotificationMetadata, revealNotificationMetadata } = require('./customerDataFields');

const subscribers = new Map();
const VALID_TYPES = new Set(['info', 'success', 'warning', 'security']);

function serializeNotification(row) {
  let metadata = {};
  try { metadata = JSON.parse(revealNotificationMetadata(sqlite, row.account_id, row.metadata) || '{}'); } catch (_) { /* Invalid legacy metadata stays empty. */ }
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
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
