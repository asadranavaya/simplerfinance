function summarizeTransactions(transactions) {
  const summary = {
    total: 0, postedOutflows: 0, pending: 0, positive: 0, imported: 0,
    earliestPostedAt: null, latestPostedAt: null,
  };
  for (const transaction of transactions || []) {
    summary.total += 1;
    const amount = Number(transaction.amount);
    if (transaction.pending) summary.pending += 1;
    else if (Number.isFinite(amount) && amount < 0) summary.postedOutflows += 1;
    if (Number.isFinite(amount) && amount >= 0) summary.positive += 1;
    if (transaction.expenseId) summary.imported += 1;
    if (transaction.postedAt && (!summary.earliestPostedAt || transaction.postedAt < summary.earliestPostedAt)) {
      summary.earliestPostedAt = transaction.postedAt;
    }
    if (transaction.postedAt && (!summary.latestPostedAt || transaction.postedAt > summary.latestPostedAt)) {
      summary.latestPostedAt = transaction.postedAt;
    }
  }
  return summary;
}

module.exports = { summarizeTransactions };
