const CATEGORY_KEY = /(?:^|[_\-\s])(category|categories)$/i;
const CAMEL_CATEGORY_KEY = /(?:Category|Categories)$/;
const VALUE_KEYS = new Set(['name', 'label', 'primary', 'detailed', 'detail', 'value']);

function cleanProviderCategory(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned && cleaned.length <= 80 ? cleaned : null;
}

function categoryKey(key) {
  const value = String(key || '');
  return CATEGORY_KEY.test(value) || CAMEL_CATEGORY_KEY.test(value);
}

function extractProviderCategories(extra, limit = 5) {
  const found = [];
  const seen = new Set();
  let visited = 0;

  const add = value => {
    const cleaned = cleanProviderCategory(value);
    const normalized = cleaned?.toLocaleLowerCase();
    if (!cleaned || seen.has(normalized) || found.length >= limit) return;
    seen.add(normalized);
    found.push(cleaned);
  };

  const collectCategoryValue = (value, depth) => {
    if (found.length >= limit || depth > 4 || value == null) return;
    if (Array.isArray(value)) {
      value.slice(0, 10).forEach(item => collectCategoryValue(item, depth + 1));
      return;
    }
    if (typeof value !== 'object') {
      add(value);
      return;
    }
    for (const [key, nested] of Object.entries(value).slice(0, 20)) {
      if (VALUE_KEYS.has(String(key).toLocaleLowerCase()) || categoryKey(key)) {
        collectCategoryValue(nested, depth + 1);
      }
    }
  };

  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 4 || visited >= 60 || found.length >= limit) return;
    visited += 1;
    for (const [key, nested] of Object.entries(value).slice(0, 30)) {
      if (categoryKey(key)) collectCategoryValue(nested, depth + 1);
      else if (nested && typeof nested === 'object') visit(nested, depth + 1);
    }
  };

  visit(extra);
  return found;
}

module.exports = { extractProviderCategories };
