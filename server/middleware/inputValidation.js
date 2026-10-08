const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 10;
const MAX_ARRAY_ITEMS = 500;
const MAX_STRING_LENGTH = 10_000;

function inspectJson(value, depth = 0) {
  if (depth > MAX_DEPTH) return 'Request data is nested too deeply.';
  if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) return 'A text value is too long.';
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) return 'A list contains too many items.';
    for (const item of value) {
      const error = inspectJson(item, depth + 1);
      if (error) return error;
    }
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) return 'Request contains a prohibited property name.';
      if (key.length > 100) return 'A property name is too long.';
      const error = inspectJson(item, depth + 1);
      if (error) return error;
    }
  }
  return null;
}

function validateJsonBody(req, res, next) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Request body must be a JSON object.' });
    }
    const error = inspectJson(req.body);
    if (error) return res.status(400).json({ error });
  }
  next();
}

function cleanText(value, { label = 'Text', max = 200, required = false } = {}) {
  if (value == null && !required) return { value: null };
  if (typeof value !== 'string') return { error: `${label} must be text.` };
  const cleaned = value.trim();
  if (required && !cleaned) return { error: `${label} is required.` };
  if (cleaned.length > max) return { error: `${label} must be ${max} characters or fewer.` };
  return { value: cleaned };
}

function cleanNumber(value, { label = 'Value', min = -1e15, max = 1e15, required = false } = {}) {
  if ((value === '' || value == null) && !required) return { value: null };
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return { error: `${label} must be a valid number.` };
  if (number < min || number > max) return { error: `${label} must be between ${min} and ${max}.` };
  return { value: number };
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cleanId(value, label = 'Identifier') {
  if (typeof value !== 'string' && typeof value !== 'number') return { error: `${label} is invalid.` };
  const id = String(value);
  if (!id || id.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(id)) return { error: `${label} is invalid.` };
  return { value: id };
}

function hasOnlyKeys(object, allowed) {
  return object && typeof object === 'object' && !Array.isArray(object)
    && Object.keys(object).every(key => allowed.includes(key));
}

module.exports = { cleanId, cleanNumber, cleanText, hasOnlyKeys, isIsoDate, validateJsonBody };
