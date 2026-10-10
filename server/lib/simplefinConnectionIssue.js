const { sanitizeSimplefinError } = require('./simplefinSecurity');

function storedWarnings(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((warning) => ({
          message: sanitizeSimplefinError(warning?.message || warning?.msg || 'SimpleFIN reported an issue.'),
          accountId: warning?.accountId == null ? null : String(warning.accountId),
          connectionId: warning?.connectionId == null ? null : String(warning.connectionId),
        }))
        .filter((warning) => warning.message);
    }
  } catch {
    // Sync failures are stored as plain, already-sanitized text.
  }
  return [{ message: sanitizeSimplefinError(value), accountId: null, connectionId: null }];
}

function storedMessages(value) {
  return storedWarnings(value).map((warning) => warning.message);
}

function summarizeMessages(messages) {
  const unique = [...new Set(messages)].filter(Boolean);
  if (!unique.length) return null;
  const visible = unique.slice(0, 2).join(' • ');
  return unique.length > 2 ? `${visible} • ${unique.length - 2} more issue${unique.length === 3 ? '' : 's'}` : visible;
}

function connectionIdsMatch(first, second) {
  const left = String(first || '');
  const right = String(second || '');
  if (!left || !right) return false;
  return left === right || left.endsWith(`-${right}`) || right.endsWith(`-${left}`);
}

function simplefinConnectionIssue(connection, { isStale = false, remoteAccountId = null, remoteConnectionId = null } = {}) {
  const warnings = storedWarnings(connection?.lastError).filter((warning) => {
    if (warning.accountId) return warning.accountId === String(remoteAccountId || '');
    if (warning.connectionId) return connectionIdsMatch(warning.connectionId, remoteConnectionId);
    return true;
  });
  const details = summarizeMessages(warnings.map((warning) => warning.message));
  if (connection?.status === 'reconnect_required') {
    return details ? `Reconnect required. ${details}` : 'Reconnect this SimpleFIN connection in Settings.';
  }
  if (connection?.status && !['active', 'syncing'].includes(connection.status)) {
    return details || `The SimpleFIN connection is ${String(connection.status).replaceAll('_', ' ')}.`;
  }
  if (details) return details;
  if (!isStale) return null;
  if (!connection?.lastSyncSucceededAt) return 'This account has not completed a successful SimpleFIN sync yet.';
  return 'This account has not completed a successful SimpleFIN sync in the last 12 hours.';
}

module.exports = { connectionIdsMatch, simplefinConnectionIssue, storedMessages, storedWarnings };
