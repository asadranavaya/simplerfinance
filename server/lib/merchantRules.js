function normalizeMerchant(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:purchase|debit|card|pos|payment|pending)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value) {
  return value.replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

function suggestedMerchant(value) {
  const normalized = normalizeMerchant(value);
  if (!normalized) return '';
  const knownPatterns = [
    [/^(amazon mktpl|amzn mktp(?: us)?)(?:\s+[a-z0-9]{6,})?$/, 'Amazon'],
    [/^(paypal)(?:\s+\*)?\s+(.+?)(?:\s+[a-z0-9]{8,})?$/, (_match, processor, merchant) => `${processor} ${merchant}`],
  ];
  for (const [pattern, replacement] of knownPatterns) {
    const match = normalized.match(pattern);
    if (match) return titleCase(typeof replacement === 'function' ? replacement(...match) : replacement);
  }
  return titleCase(normalized.replace(/\s+[a-z0-9]{8,}$/, '').trim() || normalized);
}

function merchantMatches(description, normalizedPattern) {
  const descriptionTokens = normalizeMerchant(description).split(' ').filter(Boolean);
  const patternTokens = normalizeMerchant(normalizedPattern).split(' ').filter(Boolean);
  if (!patternTokens.length || patternTokens.length > descriptionTokens.length) return false;
  return descriptionTokens.some((_, start) => patternTokens.every((token, offset) => descriptionTokens[start + offset] === token));
}

module.exports = { merchantMatches, normalizeMerchant, suggestedMerchant };
