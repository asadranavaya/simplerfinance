function customerPaidAmount(amount, split) {
  const original = Number(amount) || 0;
  if (!split || !Array.isArray(split.allocations)) return original;
  const assigned = split.allocations.reduce((sum, allocation) => sum + Math.max(0, Number(allocation.value) || 0), 0);
  const customerShare = split.mode === 'percent'
    ? Math.abs(original) * Math.max(0, 100 - Math.min(100, assigned)) / 100
    : Math.max(0, Math.abs(original) - Math.min(Math.abs(original), assigned));
  return original < 0 ? -customerShare : customerShare;
}

module.exports = { customerPaidAmount };
