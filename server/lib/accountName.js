const ACCOUNT_NAME_MAX_LENGTH = 50;

function validateAccountName(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { error: 'Display name is required' };
  }
  const name = value.trim();
  if (name.length > ACCOUNT_NAME_MAX_LENGTH) {
    return { error: `Display name must be ${ACCOUNT_NAME_MAX_LENGTH} characters or fewer` };
  }
  return { name };
}

module.exports = { ACCOUNT_NAME_MAX_LENGTH, validateAccountName };
