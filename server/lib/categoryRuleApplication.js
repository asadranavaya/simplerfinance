const { merchantMatches } = require('./merchantRules');

function sameOrderedValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function replaceExpenseCategories(metadata = {}, ruleCategoryNames = []) {
  const categories = [...new Set(ruleCategoryNames.map(value => String(value || '').trim()).filter(Boolean))];
  if (!categories.length) throw new Error('A categorization rule must contain at least one category.');
  const current = Array.isArray(metadata.categories) ? metadata.categories : [];
  const mainCategory = categories[0];
  return {
    metadata: { ...metadata, categories, mainCategory },
    changed: metadata.mainCategory !== mainCategory || !sameOrderedValues(current, categories),
  };
}

function ruleMatchesPurchase(rule, description, purchaseDate) {
  const date = String(purchaseDate || '').slice(0, 10);
  return Boolean(date
    && date >= (rule?.effectiveFrom || '1970-01-01')
    && merchantMatches(description, rule?.normalizedMerchant));
}

module.exports = { replaceExpenseCategories, ruleMatchesPurchase };
