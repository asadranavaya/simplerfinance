const { eq } = require('drizzle-orm');
const { db } = require('../db');
const { simplefinConnections } = require('../db/schema');
const { syncConnection } = require('./simplefinSync');
const { scheduleFromBase } = require('./simplefinSchedule');
const { recordImpersonatedServiceOperation } = require('./serviceTelemetry');

const TICK_MS = 60 * 1000;
const START_DELAY_MS = 15 * 1000;
const STALE_LOCK_MS = 15 * 60 * 1000;
let tickRunning = false;

function initializeMissingSchedules(now = new Date()) {
  const rows = db.select().from(simplefinConnections).all();
  for (const connection of rows) {
    if (!connection.autoSyncEnabled || connection.nextScheduledSyncAt) continue;
    const base = connection.lastSyncSucceededAt || connection.createdAt || now;
    db.update(simplefinConnections).set({
      nextScheduledSyncAt: scheduleFromBase(base, connection.syncMinute, now),
    }).where(eq(simplefinConnections.id, connection.id)).run();
  }
}

function isConnectionDue(connection, now = new Date()) {
  const iso = now.toISOString();
  return Boolean(
    connection.autoSyncEnabled
    && (connection.status === 'active' || (
      connection.status === 'syncing'
      && connection.lastSyncStartedAt
      && now.getTime() - new Date(connection.lastSyncStartedAt).getTime() >= STALE_LOCK_MS
    ))
    && connection.nextScheduledSyncAt
    && connection.nextScheduledSyncAt <= iso
    && (!connection.nextSyncAllowedAt || connection.nextSyncAllowedAt <= iso)
  );
}

function dueConnections(now = new Date()) {
  return db.select().from(simplefinConnections).all().filter((connection) => isConnectionDue(connection, now));
}

async function runSchedulerTick(now = new Date()) {
  if (tickRunning) return { skipped: true, attempted: 0 };
  tickRunning = true;
  let attempted = 0;
  try {
    initializeMissingSchedules(now);
    for (const connection of dueConnections(now)) {
      attempted += 1;
      try {
        await recordImpersonatedServiceOperation({
          subscriberId: connection.userId,
          dataPlaneCall: '/api/simplefin/connections/:id/sync',
          method: 'POST',
          counters: ['simplefin_sync=1'],
          resultCounters: result => result?.pendingTransactionsRetired
            ? [`pending_transactions_retired=${result.pendingTransactionsRetired}`] : [],
        }, () => syncConnection(connection.id, connection.userId, { scheduled: true }));
      } catch (error) {
        // syncConnection persists a sanitized failure and backoff. Log only a
        // safe identifier/code; never provider messages or credentials.
        console.warn(`[SimpleFIN scheduler] connection ${connection.id} failed (${error.code || 'sync_failed'})`);
      }
    }
    return { skipped: false, attempted };
  } finally {
    tickRunning = false;
  }
}

function startSimplefinScheduler() {
  const startTimer = setTimeout(() => {
    runSchedulerTick().catch(() => {});
    const interval = setInterval(() => runSchedulerTick().catch(() => {}), TICK_MS);
    interval.unref?.();
  }, START_DELAY_MS);
  startTimer.unref?.();
  return startTimer;
}

module.exports = { isConnectionDue, initializeMissingSchedules, dueConnections, runSchedulerTick, startSimplefinScheduler };
