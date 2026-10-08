export function utcDate(year, month, day) {
  return new Date(Date.UTC(year, month, day));
}

export function daysInMonth(year, month) {
  return utcDate(year, month + 1, 0).getUTCDate();
}

export function projectedDateForMonth(lastPayment, year, month) {
  const observed = new Date(lastPayment);
  if (Number.isNaN(observed.getTime())) return null;
  return utcDate(year, month, Math.min(observed.getUTCDate(), daysInMonth(year, month)));
}

export function nextEstimatedPayment(lastPayment, now = new Date()) {
  const observed = new Date(lastPayment);
  if (Number.isNaN(observed.getTime())) return null;
  const today = utcDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let year = observed.getUTCFullYear();
  let month = observed.getUTCMonth() + 1;
  if (month > 11) { year += 1; month = 0; }
  let estimate = projectedDateForMonth(observed, year, month);
  while (estimate < today) {
    month += 1;
    if (month > 11) { year += 1; month = 0; }
    estimate = projectedDateForMonth(observed, year, month);
  }
  return estimate;
}
