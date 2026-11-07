export function purchaseMoney(amount, currency = 'USD') {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount) || 0); }
  catch { return `${Number(amount || 0).toFixed(2)} ${currency}`; }
}
