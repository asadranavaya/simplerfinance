function isImportedExpenseForTransactions(expense, transactionIds) {
  if (!expense || !(transactionIds instanceof Set)) return false;
  try {
    const { sqlite } = require('../db');
    const { revealExpenseData } = require('./customerDataFields');
    const metadata = JSON.parse(revealExpenseData(sqlite, expense) || '{}');
    return metadata.source === 'simplefin' && transactionIds.has(metadata.simplefinTransactionId);
  } catch {
    return false;
  }
}

module.exports = { isImportedExpenseForTransactions };
