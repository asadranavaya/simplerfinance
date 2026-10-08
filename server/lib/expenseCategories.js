const UNCATEGORIZED = 'Uncategorized';

function isUncategorized(value) {
  return String(value || '').trim().toLocaleLowerCase() === UNCATEGORIZED.toLocaleLowerCase();
}

function normalizeExpenseCategories(metadata = {}) {
  const supplied = Array.isArray(metadata.categories) ? metadata.categories : [];
  const realCategories = supplied.filter(category => !isUncategorized(category));
  const categories = realCategories.length ? realCategories : [UNCATEGORIZED];
  const requestedPrimary = String(metadata.mainCategory || '').trim();
  const mainCategory = !isUncategorized(requestedPrimary) && categories.includes(requestedPrimary)
    ? requestedPrimary
    : categories[0];
  return { ...metadata, categories, mainCategory };
}

module.exports = { UNCATEGORIZED, isUncategorized, normalizeExpenseCategories };
