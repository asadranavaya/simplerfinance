const { normalizeIconPattern, matchRule } = require('./iconResolver');

function resolveSubscriptionIcon(subscription, primaryCategoryByDescription, matcher = matchRule) {
  const candidates = [subscription?.description, ...(subscription?.variants || [])].filter(Boolean);
  const merchantIcon = candidates.map(value => matcher('merchant', value)).find(Boolean);
  if (merchantIcon) return merchantIcon;

  const category = candidates
    .map(value => primaryCategoryByDescription.get(normalizeIconPattern(value)))
    .find(Boolean);
  return category ? matcher('category', category) : null;
}

module.exports = { resolveSubscriptionIcon };
