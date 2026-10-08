function normalizedCategoryName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name && name.length <= 80 ? name : null;
}

module.exports = { normalizedCategoryName };
