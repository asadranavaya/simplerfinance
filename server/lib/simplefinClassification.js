const DAY_MS = 24 * 60 * 60 * 1000;
const REFUND_PATTERN = /\b(refund|return|reversal|reversed|credit memo|merchant credit)\b/i;
const CARD_PAYMENT_PATTERN = /\b(credit card payment|card payment|autopay|payment thank you|payment received|online payment (?:to )?(?:visa|mastercard|amex|discover))\b/i;
const TRANSFER_PATTERN = /\b(transfer|xfer|internal transfer)\b/i;
const UNCERTAIN_PATTERN = /\b(ach|wire|zelle|venmo|cash app|paypal)\b/i;

function findCounterpart(transaction, localType, candidates) {
  const amount = Number(transaction.amount);
  const posted = Date.parse(transaction.postedAt);
  if (!Number.isFinite(amount) || !Number.isFinite(posted)) return null;
  const matches = (candidates || []).filter(candidate => {
    if (candidate.id === transaction.id || candidate.simplefinAccountId === transaction.simplefinAccountId) return false;
    const candidateAmount = Number(candidate.amount);
    const candidateDate = Date.parse(candidate.postedAt);
    return Number.isFinite(candidateAmount) && Math.abs(amount + candidateAmount) < 0.005
      && Number.isFinite(candidateDate) && Math.abs(posted - candidateDate) <= 3 * DAY_MS;
  });
  return matches.length === 1 ? matches[0] : null;
}

function classifyTransaction(transaction, localType, candidates = [], accountTypes = new Map()) {
  if (transaction.pending) return { classification: 'pending', reason: 'Provider transaction is pending.' };
  const amount = Number(transaction.amount);
  if (!Number.isFinite(amount) || amount === 0) return { classification: 'review', reason: 'Amount requires review.' };
  const description = String(transaction.description || '');
  const counterpart = findCounterpart(transaction, localType, candidates);
  if (counterpart) {
    const counterpartType = accountTypes.get(counterpart.simplefinAccountId);
    const isCardPayment = (localType === 'bank' && amount < 0 && counterpartType === 'credit_card')
      || (localType === 'credit_card' && amount > 0 && counterpartType === 'bank');
    return {
      classification: isCardPayment ? 'card_payment' : 'transfer',
      reason: isCardPayment ? 'Matched the opposite side of a linked card payment.' : 'Matched an equal opposite transaction in another linked account.',
    };
  }
  if (REFUND_PATTERN.test(description)) return { classification: 'refund', reason: 'Description indicates a refund or reversal.' };
  if (CARD_PAYMENT_PATTERN.test(description)) return { classification: 'card_payment', reason: 'Description indicates a credit-card payment.' };
  if (amount < 0 && /\bfee\b/i.test(description)) return { classification: 'expense', reason: 'Posted fee treated as spending.' };
  if (TRANSFER_PATTERN.test(description)) return { classification: 'transfer', reason: 'Description indicates an account transfer.' };
  if (UNCERTAIN_PATTERN.test(description)) return { classification: 'review', reason: 'Payment rail could represent spending or a transfer.' };
  if (localType === 'credit_card' && amount > 0) return { classification: 'refund', reason: 'Positive credit-card activity is treated as a refund or credit.' };
  if (localType === 'bank' && amount > 0) return { classification: 'income', reason: 'Positive bank activity is treated as income or a deposit.' };
  if (amount < 0) return { classification: 'expense', reason: 'Posted outflow treated as spending.' };
  return { classification: 'review', reason: 'Transaction requires classification.' };
}

module.exports = { classifyTransaction, findCounterpart };
