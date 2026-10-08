const { sqlite } = require('../db');
const { createNotification } = require('./notifications');
const crypto = require('crypto');

function digestDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function recordSimplefinSyncDigest(accountId, summary = {}, now = new Date()) {
  if (!accountId) return;
  const date = digestDate(now);
  sqlite.transaction(() => {
    const existing = sqlite.prepare(`SELECT * FROM simplefin_notification_digests WHERE account_id=? AND digest_date=?`).get(accountId,date);
    let byConnection = {};
    let warningKeys = [];
    try {
      const parsed = JSON.parse(existing?.connection_accounts || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) byConnection = parsed;
    } catch {}
    try {
      const parsed = JSON.parse(existing?.warning_keys || '[]');
      if (Array.isArray(parsed)) warningKeys = parsed.filter(value => typeof value === 'string').slice(0, 200);
    } catch {}
    const checked = Math.max(0, Number(summary.accountsChecked) || 0);
    if (summary.connectionId) byConnection[String(summary.connectionId)] = checked;
    const accountsChecked = Object.keys(byConnection).length
      ? Object.values(byConnection).reduce((total, count) => total + Math.max(0, Number(count) || 0), 0)
      : Math.max(Number(existing?.accounts_checked) || 0, checked);
    const connectionKey = String(summary.connectionId || 'unknown');
    const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
    const incomingWarningKeys = warnings.length
      ? warnings.map(warning => crypto.createHash('sha256').update(`${connectionKey}\0${warning?.code || ''}\0${warning?.message || ''}`).digest('hex'))
      : Array.from({ length: Math.max(0, Number(summary.warningCount) || 0) }, (_, index) => `${connectionKey}:legacy:${index}`);
    warningKeys = [...new Set([...warningKeys, ...incomingWarningKeys])].slice(0, 200);
    const warningCount = warningKeys.length;
    if (!existing) {
      sqlite.prepare(`INSERT INTO simplefin_notification_digests(account_id,digest_date,sync_count,accounts_checked,transactions_updated,expenses_imported,warning_count,failure_count,connection_accounts,warning_keys) VALUES(?,?,1,?,?,?,?,?,?,?)`).run(accountId,date,accountsChecked,Math.max(0,Number(summary.transactionsUpdated)||0),Math.max(0,Number(summary.expensesImported)||0),warningCount,summary.failed?1:0,JSON.stringify(byConnection),JSON.stringify(warningKeys));
      return;
    }
    sqlite.prepare(`UPDATE simplefin_notification_digests SET sync_count=sync_count+1, accounts_checked=?, transactions_updated=transactions_updated+?, expenses_imported=expenses_imported+?, warning_count=?, failure_count=failure_count+?, connection_accounts=?, warning_keys=? WHERE account_id=? AND digest_date=?`).run(accountsChecked,Math.max(0,Number(summary.transactionsUpdated)||0),Math.max(0,Number(summary.expensesImported)||0),warningCount,summary.failed?1:0,JSON.stringify(byConnection),JSON.stringify(warningKeys),accountId,date);
  })();
}

function flushSimplefinSyncDigests(now = new Date()) {
  const rows = sqlite.prepare(`SELECT * FROM simplefin_notification_digests WHERE digest_date < ? ORDER BY digest_date`).all(digestDate(now));
  let sent = 0;
  for (const row of rows) {
    sqlite.transaction(() => {
      const attention = row.failure_count > 0 || row.warning_count > 0;
      const details = [
        `${row.sync_count} sync${row.sync_count === 1 ? '' : 's'}`,
        `${row.accounts_checked} account${row.accounts_checked === 1 ? '' : 's'} checked`,
        `${row.transactions_updated} transaction${row.transactions_updated === 1 ? '' : 's'} updated`,
        `${row.expenses_imported} expense${row.expenses_imported === 1 ? '' : 's'} imported`,
      ];
      if (row.warning_count) details.push(`${row.warning_count} warning${row.warning_count === 1 ? '' : 's'}`);
      if (row.failure_count) details.push(`${row.failure_count} failed`);
      createNotification(row.account_id, {
        type: attention ? 'warning' : 'success',
        title: attention ? 'Daily SimpleFIN summary needs attention' : 'Daily SimpleFIN summary',
        message: details.join(' · '),
        metadata: { source: 'simplefin', digestDate: row.digest_date },
      });
      sqlite.prepare('DELETE FROM simplefin_notification_digests WHERE account_id = ? AND digest_date = ?').run(row.account_id, row.digest_date);
      sent += 1;
    })();
  }
  return sent;
}

module.exports = { digestDate, flushSimplefinSyncDigests, recordSimplefinSyncDigest };
