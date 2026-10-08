const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function validMinute(value) {
  const minute = Number(value);
  return Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 17;
}

function scheduleFromBase(baseValue, minuteValue, nowValue = new Date()) {
  const now = new Date(nowValue);
  const base = new Date(baseValue || now);
  if (Number.isNaN(base.getTime())) return scheduleFromBase(now, minuteValue, now);
  const target = new Date(base.getTime() + SIX_HOURS_MS);
  target.setUTCMinutes(validMinute(minuteValue), 0, 0);
  if (target <= now) return now.toISOString();
  return target.toISOString();
}

function advanceScheduledSlot(previousValue, minuteValue, nowValue = new Date()) {
  const now = new Date(nowValue);
  let next = new Date(previousValue);
  if (Number.isNaN(next.getTime())) return scheduleFromBase(now, minuteValue, now);
  next.setUTCMinutes(validMinute(minuteValue), 0, 0);
  do { next = new Date(next.getTime() + SIX_HOURS_MS); } while (next <= now);
  return next.toISOString();
}

function nextScheduleAfterSuccess(connection, { scheduled = false, now = new Date() } = {}) {
  return scheduled && connection.nextScheduledSyncAt
    ? advanceScheduledSlot(connection.nextScheduledSyncAt, connection.syncMinute, now)
    : scheduleFromBase(now, connection.syncMinute, now);
}

module.exports = {
  SIX_HOURS_MS,
  validMinute,
  scheduleFromBase,
  advanceScheduledSlot,
  nextScheduleAfterSuccess,
};
