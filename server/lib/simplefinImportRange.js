function validatedImportDate(value, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const earliest = new Date(Date.UTC(now.getUTCFullYear() - 2, now.getUTCMonth(), now.getUTCDate()))
    .toISOString().slice(0, 10);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value >= earliest && value <= today ? value : null;
}

module.exports = { validatedImportDate };
