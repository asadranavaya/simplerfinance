const fs = require('fs');
const path = require('path');
const { lt } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const { simplefinSyncRuns, authSecurityEvents } = require('../db/schema');
const { captureCurrentSavingsTargets } = require('./savingsProgress');
const { flushSimplefinSyncDigests } = require('./simplefinNotificationDigest');

const BACKUP_DIR = path.join(__dirname, '../../backups');
const ICON_ASSET_DIR = path.join(__dirname, '../../data/icon-assets');
const DAY_MS = 24 * 60 * 60 * 1000;

function pruneSyncRuns(now = new Date(), retentionDays = 180) {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  return db.delete(simplefinSyncRuns).where(lt(simplefinSyncRuns.startedAt, cutoff)).run().changes;
}

function pruneSecurityEvents(now = new Date(), retentionDays = 180) {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  return db.delete(authSecurityEvents).where(lt(authSecurityEvents.lastSeenAt, cutoff)).run().changes;
}

function pruneRateLimitBuckets(now = new Date()) {
  return sqlite.prepare('DELETE FROM rate_limit_buckets WHERE reset_at <= ?').run(now.getTime()).changes;
}

function prunePendingIconSubmissions(now = new Date(), retentionDays = 30) {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  const expired = sqlite.prepare(`SELECT id, icon_asset_id FROM icon_rules WHERE status='pending' AND created_at < ?`).all(cutoff);
  let removed = 0;
  const remove = sqlite.transaction(rule => {
    sqlite.prepare('DELETE FROM icon_rules WHERE id=?').run(rule.id);
    const uses = sqlite.prepare(`SELECT count(*) count FROM icon_rules WHERE icon_asset_id=? AND status IN ('pending','approved')`).get(rule.icon_asset_id).count;
    if (uses) return null;
    const asset = sqlite.prepare('SELECT storage_key FROM icon_assets WHERE id=?').get(rule.icon_asset_id);
    sqlite.prepare('DELETE FROM icon_assets WHERE id=?').run(rule.icon_asset_id);
    return asset?.storage_key || null;
  });
  for (const rule of expired) {
    const key = remove(rule);
    if (key) for (const size of [32, 64, 128]) {
      try { fs.unlinkSync(path.join(ICON_ASSET_DIR, `${key}-${size}.webp`)); } catch {}
    }
    removed += 1;
  }
  return removed;
}

async function createDatabaseBackup(now = new Date()) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const destination = path.join(BACKUP_DIR, `budget-${stamp}.db`);
  await sqlite.backup(destination);
  fs.chmodSync(destination, 0o600);
  return destination;
}

function pruneBackups(now = new Date(), retentionDays = 14) {
  if (!fs.existsSync(BACKUP_DIR)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!/^budget-.*\.db$/.test(name)) continue;
    const file = path.join(BACKUP_DIR, name);
    if (now.getTime() - fs.statSync(file).mtimeMs > retentionDays * DAY_MS) {
      fs.unlinkSync(file); removed += 1;
    }
  }
  return removed;
}

async function runDailyMaintenance(now = new Date()) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const recentBackup = fs.readdirSync(BACKUP_DIR).filter(name => /^budget-.*\.db$/.test(name))
    .map(name => fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs)
    .some(modified => now.getTime() - modified < 20 * 60 * 60 * 1000);
  const backup = recentBackup ? null : await createDatabaseBackup(now);
  return {
    backup,
    syncRunsRemoved: pruneSyncRuns(now),
    securityEventsRemoved: pruneSecurityEvents(now),
    rateLimitBucketsRemoved: pruneRateLimitBuckets(now),
    iconSubmissionsRemoved: prunePendingIconSubmissions(now),
    savingsTargetsCaptured: captureCurrentSavingsTargets(now),
    simplefinDigestsSent: flushSimplefinSyncDigests(now),
    backupsRemoved: pruneBackups(now),
  };
}

function startOperationsMaintenance() {
  const startup = setTimeout(() => runDailyMaintenance().catch(error => console.error('[maintenance] failed:', error.message)), 30000);
  startup.unref?.();
  const timer = setInterval(() => runDailyMaintenance().catch(error => console.error('[maintenance] failed:', error.message)), DAY_MS);
  timer.unref?.();
  const digestTimer = setInterval(() => {
    try { flushSimplefinSyncDigests(); } catch (error) { console.error('[SimpleFIN digest] failed:', error.message); }
  }, 60 * 1000);
  digestTimer.unref?.();
  return timer;
}

module.exports = { BACKUP_DIR, createDatabaseBackup, pruneBackups, prunePendingIconSubmissions, pruneRateLimitBuckets, pruneSecurityEvents, pruneSyncRuns, runDailyMaintenance, startOperationsMaintenance };
