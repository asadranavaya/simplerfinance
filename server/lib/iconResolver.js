const { sqlite } = require('../db');
const { normalizeMerchant } = require('./merchantRules');

function normalizeIconPattern(value) { return normalizeMerchant(value).slice(0, 100); }
function matchRule(type, value) {
  const normalized = normalizeIconPattern(value);
  if (!normalized) return null;
  const rules = sqlite.prepare(`SELECT r.*, a.storage_key FROM icon_rules r JOIN icon_assets a ON a.id=r.icon_asset_id WHERE r.status='approved' AND a.status='approved' AND r.entity_type=? ORDER BY r.priority DESC, length(r.normalized_pattern) DESC`).all(type);
  const rule = rules.find(row => row.match_type === 'exact' ? normalized === row.normalized_pattern : normalized.includes(row.normalized_pattern));
  return rule ? { url: `/api/icons/assets/${rule.storage_key}/32`, alt: rule.display_name, source: type } : null;
}
function resolveExpenseIcon(expense, metadata = {}) {
  return matchRule('merchant', metadata.providerDescription || expense.description)
    || matchRule('category', metadata.mainCategory || expense.category)
    || null;
}
function resolveAccountIcon({ product, institution }) {
  return matchRule('financial_product', product) || matchRule('institution', institution) || null;
}
module.exports = { matchRule, normalizeIconPattern, resolveAccountIcon, resolveExpenseIcon };
