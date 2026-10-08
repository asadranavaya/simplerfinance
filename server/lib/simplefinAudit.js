const { sanitizeSimplefinError } = require('./simplefinSecurity');

const VALID_STATUSES = new Set(['running', 'succeeded', 'partial', 'failed']);
const VALID_TRIGGERS = new Set(['manual', 'automatic', 'discovery', 'reconnect']);

function safeWarnings(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 20).map((warning) => ({
      code: String(warning?.code || 'warning').slice(0, 80),
      message: sanitizeSimplefinError(warning?.message || warning?.msg || 'SimpleFIN reported a warning'),
    }));
  } catch {
    return [{ code: 'warning', message: sanitizeSimplefinError(value) }];
  }
}

function publicSyncRun(run) {
  return {
    id: run.id,
    connectionId: run.connectionId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    status: VALID_STATUSES.has(run.status) ? run.status : 'failed',
    trigger: VALID_TRIGGERS.has(run.trigger) ? run.trigger : 'manual',
    accountsReceived: Number(run.accountsReceived) || 0,
    transactionsInserted: Number(run.transactionsInserted) || 0,
    transactionsUpdated: Number(run.transactionsUpdated) || 0,
    expensesMaterialized: Number(run.expensesMaterialized) || 0,
    duplicateCandidates: Number(run.duplicateCandidates) || 0,
    warnings: safeWarnings(run.warnings),
    error: run.errorSummary ? {
      code: String(run.errorCode || 'sync_failed').slice(0, 80),
      message: sanitizeSimplefinError(run.errorSummary),
    } : null,
  };
}

module.exports = { publicSyncRun, safeWarnings };
