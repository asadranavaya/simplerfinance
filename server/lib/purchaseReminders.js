const { sqlite, db } = require('../db');
const { expenses } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { createNotification } = require('./notifications');
const { revealExpenseRecord } = require('./customerDataFields');

function getPurchaseReminder(expenseId) {
  const row = sqlite.prepare('SELECT due_at, delivered_at FROM purchase_reminders WHERE expense_id = ?').get(expenseId);
  return row ? { dueAt: row.due_at, deliveredAt: row.delivered_at } : null;
}

function deliverPurchaseReminders(now = new Date()) {
  return sqlite.transaction(() => {
    const rows = sqlite.prepare(`SELECT r.* FROM purchase_reminders r
      JOIN expenses e ON e.id = r.expense_id
      WHERE r.delivered_at IS NULL AND r.due_at <= ? AND e.hidden_at IS NULL`).all(now.toISOString());
    for (const row of rows) {
      const purchase = revealExpenseRecord(sqlite, db.select().from(expenses).where(eq(expenses.id, row.expense_id)).get());
      createNotification(row.account_id, {
        title: 'Purchase reminder',
        message: 'Time to check back on your purchase. Review its notes for details.',
        metadata: { expenseId: row.expense_id, dueAt: row.due_at, purchaseDescription: purchase.description },
      });
      sqlite.prepare('UPDATE purchase_reminders SET delivered_at = ? WHERE expense_id = ?').run(now.toISOString(), row.expense_id);
    }
    return rows.length;
  })();
}

function startPurchaseReminderScheduler() {
  const tick = () => {
    try { deliverPurchaseReminders(); } catch (error) { console.error('[purchase-reminders] Delivery failed:', error.message); }
  };
  tick();
  const timer = setInterval(tick, 30_000);
  timer.unref();
  return timer;
}

module.exports = { getPurchaseReminder, deliverPurchaseReminders, startPurchaseReminderScheduler };
