const { decryptCustomerValue, encryptCustomerValue } = require('./customerEncryption');

function encryptedField(sqlite, accountId, purpose, value) {
  return encryptCustomerValue(sqlite, accountId, purpose, value);
}

function decryptedField(sqlite, accountId, purpose, value) {
  return decryptCustomerValue(sqlite, accountId, purpose, value);
}

function protectFinancialAccountData(sqlite, accountId, type, value) {
  return encryptedField(sqlite, accountId, `${type}:data`, value);
}

function revealFinancialAccountData(sqlite, accountId, type, value) {
  return decryptedField(sqlite, accountId, `${type}:data`, value);
}

function protectGoalData(sqlite, accountId, value) {
  return encryptedField(sqlite, accountId, 'goal:data', value);
}

function revealGoalData(sqlite, accountId, value) {
  return decryptedField(sqlite, accountId, 'goal:data', value);
}

function expenseOwnerId(sqlite, expense) {
  return expense?.spendingId ? sqlite.prepare('SELECT user_id FROM monthly_spending WHERE id = ?').get(expense.spendingId)?.user_id : null;
}

function protectExpenseData(sqlite, accountId, value) {
  return encryptedField(sqlite, accountId, 'expense:data', value);
}

function protectExpenseRecord(sqlite, accountId, expense) {
  const payload = {
    description: expense.description,
    amount: Number(expense.amount),
    category: expense.category ?? null,
    date: expense.date ?? null,
    data: expense.data ?? null,
  };
  return {
    ...expense,
    description: '[protected]',
    amount: 0,
    category: null,
    date: null,
    data: null,
    encryptedPayload: encryptedField(sqlite, accountId, 'expense:record', JSON.stringify(payload)),
  };
}

function revealExpenseRecord(sqlite, expense) {
  if (!expense?.encryptedPayload) return expense;
  const accountId = expenseOwnerId(sqlite, expense);
  if (!accountId) return expense;
  const payload = JSON.parse(decryptedField(sqlite, accountId, 'expense:record', expense.encryptedPayload));
  return { ...expense, ...payload };
}

function revealExpenseData(sqlite, expense) {
  if (expense?.encryptedPayload) return revealExpenseRecord(sqlite, expense)?.data;
  const accountId = expenseOwnerId(sqlite, expense);
  return accountId ? decryptedField(sqlite, accountId, 'expense:data', expense.data) : expense?.data;
}

function protectNotificationMetadata(sqlite, accountId, value) {
  return encryptedField(sqlite, accountId, 'notification:metadata', value);
}

function revealNotificationMetadata(sqlite, accountId, value) {
  return decryptedField(sqlite, accountId, 'notification:metadata', value);
}

module.exports = {
  protectExpenseData,
  protectExpenseRecord,
  protectFinancialAccountData,
  protectGoalData,
  protectNotificationMetadata,
  revealExpenseData,
  revealExpenseRecord,
  revealFinancialAccountData,
  revealGoalData,
  revealNotificationMetadata,
};
