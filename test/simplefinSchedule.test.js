const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scheduleFromBase,
  advanceScheduledSlot,
  nextScheduleAfterSuccess,
} = require('../server/lib/simplefinSchedule');
const { isConnectionDue } = require('../server/lib/simplefinScheduler');

test('creates a roughly six-hour schedule at the connection minute', () => {
  const now = new Date('2026-08-07T10:42:30Z');
  const next = new Date(scheduleFromBase(now, 17, now));
  assert.equal(next.getUTCMinutes(), 17);
  assert.equal(next.getUTCSeconds(), 0);
  assert.ok(next > now);
  assert.ok(next.getTime() - now.getTime() >= 5 * 60 * 60 * 1000);
  assert.ok(next.getTime() - now.getTime() <= 7 * 60 * 60 * 1000);
});

test('scheduled success advances from the persisted slot without drift', () => {
  const previous = '2026-08-07T12:17:00.000Z';
  const next = advanceScheduledSlot(previous, 17, new Date('2026-08-07T12:18:00Z'));
  assert.equal(next, '2026-08-07T18:17:00.000Z');
  assert.equal(nextScheduleAfterSuccess({ nextScheduledSyncAt: previous, syncMinute: 17 }, {
    scheduled: true,
    now: new Date('2026-08-07T12:18:00Z'),
  }), next);
});

test('missed slots advance until the next future six-hour slot', () => {
  const next = advanceScheduledSlot('2026-08-06T00:11:00.000Z', 11, new Date('2026-08-07T13:00:00Z'));
  assert.equal(next, '2026-08-07T18:11:00.000Z');
});

test('scheduler respects pause, backoff, and stale-lock recovery', () => {
  const now = new Date('2026-08-07T13:00:00Z');
  const base = {
    autoSyncEnabled: true,
    status: 'active',
    nextScheduledSyncAt: '2026-08-07T12:17:00.000Z',
    nextSyncAllowedAt: null,
  };
  assert.equal(isConnectionDue(base, now), true);
  assert.equal(isConnectionDue({ ...base, autoSyncEnabled: false }, now), false);
  assert.equal(isConnectionDue({ ...base, nextSyncAllowedAt: '2026-08-07T14:00:00.000Z' }, now), false);
  assert.equal(isConnectionDue({
    ...base,
    status: 'syncing',
    lastSyncStartedAt: '2026-08-07T12:30:00.000Z',
  }, now), true);
  assert.equal(isConnectionDue({
    ...base,
    status: 'syncing',
    lastSyncStartedAt: '2026-08-07T12:55:00.000Z',
  }, now), false);
});
