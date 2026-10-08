const SENSITIVE_URL = /https:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s]+/gi;
const TOKEN_LIKE = /\b[A-Za-z0-9_-]{48,}={0,2}\b/g;
const NAMED_SECRET = /\b(setup[ _-]?token|access[ _-]?url|token)\s*[:=]\s*[^\s,;]+/gi;
const BEARER_SECRET = /\bbearer\s+[^\s,;]+/gi;

function sanitizeSimplefinError(value) {
  const message = value instanceof Error ? value.message : String(value || 'Unknown SimpleFIN error');
  return message
    .replace(SENSITIVE_URL, '[REDACTED_SIMPLEFIN_URL]')
    .replace(NAMED_SECRET, '$1=[REDACTED]')
    .replace(BEARER_SECRET, 'Bearer [REDACTED]')
    .replace(TOKEN_LIKE, '[REDACTED_TOKEN]')
    .slice(0, 500);
}

module.exports = { sanitizeSimplefinError };
