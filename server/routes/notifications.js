const { Router } = require('express');
const { sqlite, db } = require('../db');
const { expenses } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { serializeNotification, subscribe } = require('../lib/notifications');

const router = Router();

router.get('/upcoming', (req, res) => {
  const { revealExpenseRecord } = require('../lib/customerDataFields');
  const rows = sqlite.prepare(`SELECT e.*, r.due_at FROM purchase_reminders r
    JOIN expenses e ON e.id = r.expense_id
    JOIN monthly_spending s ON s.id = e.spending_id
    WHERE r.account_id = ? AND s.user_id = ? AND r.delivered_at IS NULL AND e.hidden_at IS NULL
    ORDER BY r.due_at, e.id`).all(req.user.accountId, req.user.accountId);
  res.json({ events: rows.map(row => {
    const purchase = revealExpenseRecord(sqlite, db.select().from(expenses).where(eq(expenses.id, row.id)).get());
    const metadata = JSON.parse(purchase.data || '{}');
    return { expenseId: row.id, description: purchase.description, notes: metadata.notes || '', dueAt: row.due_at };
  }) });
});

router.get('/', (req, res) => {
  const rows = sqlite.prepare(`
    SELECT id, account_id, type, title, message, metadata, created_at, read_at
    FROM notifications
    WHERE account_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(req.user.accountId);
  const unreadCount = sqlite.prepare(`SELECT COUNT(*) AS count FROM notifications WHERE account_id = ? AND read_at IS NULL`).get(req.user.accountId).count;
  res.json({ notifications: rows.map(serializeNotification), unreadCount });
});

router.patch('/read-all', (req, res) => {
  const result = sqlite.prepare(`DELETE FROM notifications WHERE account_id = ?`).run(req.user.accountId);
  res.json({ deleted: result.changes });
});

router.patch('/:id/read', (req, res) => {
  const result = sqlite.prepare(`DELETE FROM notifications WHERE id = ? AND account_id = ?`).run(req.params.id, req.user.accountId);
  if (!result.changes) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ id: req.params.id, deleted: true });
});

router.get('/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');
  const unsubscribe = subscribe(req.user.accountId, res);
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

module.exports = router;
