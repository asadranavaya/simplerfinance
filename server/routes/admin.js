const { Router } = require('express');
const { eq, and } = require('drizzle-orm');
const { db, sqlite } = require('../db');
const { users, accounts, trustedDevices, simplefinConnections, simplefinSyncRuns, defaultCategories } = require('../db/schema');
const { requireAdmin } = require('../middleware/auth');
const { clearSecurityEvent, listSecurityEvents } = require('../lib/securityActivity');
const fs = require('fs');
const path = require('path');
const { ICON_ASSET_ROOT } = require('./icons');
const { lookupIpLocation } = require('../lib/ipGeolocation');
const { queryServiceLogs, getLatencyPercentiles } = require('../lib/serviceTelemetry');
const { enabledFeatures, isKnownFeature, setFeature } = require('../lib/featureFlags');
const { normalizedCategoryName } = require('../lib/categoryValidation');
const { categoryCandidates, materializeDefaultForAllAccounts, sharedDefaults } = require('../lib/defaultCategories');

const router = Router();
router.use(requireAdmin);

router.get('/categories', (_req, res) => {
  res.json({
    defaults: sharedDefaults().map(({ id, name, color, createdAt }) => ({ id, name, color, createdAt })),
    // Candidates are deliberately deduplicated without customer ids, names,
    // counts, or creator provenance.
    candidates: categoryCandidates().map(({ name, color }) => ({ name, color })),
  });
});

router.post('/categories/defaults', (req, res) => {
  if (!req.body || Object.keys(req.body).some(key => !['name', 'color'].includes(key))) {
    return res.status(400).json({ error: 'Unsupported default category field.' });
  }
  const name = normalizedCategoryName(req.body.name);
  const candidate = categoryCandidates().find(item => item.name.toLocaleLowerCase() === String(name || '').toLocaleLowerCase());
  if (!name || !candidate) return res.status(400).json({ error: 'Select an existing customer category.' });
  const color = req.body.color || candidate.color;
  if (!/^#[0-9a-f]{6}$/i.test(color)) return res.status(400).json({ error: 'Choose a valid six-digit hex color.' });
  let inserted;
  sqlite.transaction(() => {
    const result = db.insert(defaultCategories).values({
      name: candidate.name,
      normalizedName: candidate.name.toLocaleLowerCase(),
      color,
      createdAt: new Date().toISOString(),
    }).returning().get();
    inserted = result;
    materializeDefaultForAllAccounts(result);
  })();
  return res.status(201).json({ category: { id: inserted.id, name: inserted.name, color: inserted.color, createdAt: inserted.createdAt } });
});

router.delete('/categories/defaults/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid default category id is required.' });
  const category = db.select().from(defaultCategories).where(eq(defaultCategories.id, id)).get();
  if (!category) return res.status(404).json({ error: 'Default category not found.' });
  // Existing account copies remain intact and simply become removable custom
  // categories; this avoids destructive changes to customer transactions.
  db.delete(defaultCategories).where(eq(defaultCategories.id, id)).run();
  return res.json({ deleted: true });
});

router.post('/telemetry/query', (req, res) => {
  if (!req.body || Object.keys(req.body).some(key => key !== 'query')) return res.status(400).json({ error: 'Unsupported telemetry query field.' });
  try { return res.json(queryServiceLogs(req.body.query)); }
  catch (error) { return res.status(400).json({ error: error.message || 'Unable to execute telemetry query.' }); }
});

router.get('/telemetry/latency', (req, res) => {
  if (Object.keys(req.query).some(key => key !== 'hours')) return res.status(400).json({ error: 'Unsupported latency query field.' });
  if (req.query.hours && !['24', '168'].includes(req.query.hours)) return res.status(400).json({ error: 'Latency range must be 24 or 168 hours.' });
  const hours = req.query.hours === '168' ? 168 : 24;
  return res.json(getLatencyPercentiles(hours));
});

router.get('/users', (_req, res) => {
  const rows = db.select({
    id: users.id,
    email: users.email,
    accountId: users.accountId,
    createdAt: users.createdAt,
    mfaEnabled: users.mfaEnabled,
    role: users.role,
    isActive: users.isActive,
    emailVerifiedAt: users.emailVerifiedAt,
    name: accounts.name,
  }).from(users).leftJoin(accounts, eq(users.accountId, accounts.id)).all();
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ users: rows });
});

router.get('/security-activity', async (_req, res) => {
  const events = await Promise.all(listSecurityEvents().map(async event => ({
    ...event,
    approximateLocation: await lookupIpLocation(event.ipAddress),
  })));
  res.json({ events });
});

router.post('/security-activity/:id/unblock', (req, res) => {
  const event = clearSecurityEvent(req.params.id, req.user.userId);
  if (!event) return res.status(404).json({ error: 'Security event not found' });
  res.json({ ok: true, clearedAt: event.clearedAt });
});

router.get('/simplefin-health', (_req, res) => {
  const connections = db.select().from(simplefinConnections).all();
  const statusCounts = {};
  let repeatedFailures = 0;
  let staleConnections = 0;
  const now = Date.now();
  for (const connection of connections) {
    statusCounts[connection.status] = (statusCounts[connection.status] || 0) + 1;
    if (!connection.lastSyncSucceededAt || now - new Date(connection.lastSyncSucceededAt).getTime() > 24 * 60 * 60 * 1000) staleConnections += 1;
    const recent = db.select().from(simplefinSyncRuns).where(eq(simplefinSyncRuns.connectionId, connection.id)).all()
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 3);
    if (recent.length === 3 && recent.every(run => run.status === 'failed')) repeatedFailures += 1;
  }
  res.json({
    generatedAt: new Date().toISOString(),
    connections: connections.length,
    statusCounts,
    staleConnections,
    repeatedFailures,
  });
});

router.get('/icon-submissions', (_req, res) => {
  const rows = sqlite.prepare(`SELECT r.*, a.storage_key, a.byte_size FROM icon_rules r JOIN icon_assets a ON a.id=r.icon_asset_id WHERE r.status='pending' ORDER BY r.created_at`).all();
  res.json({ submissions: rows.map(row => ({ id:row.id, entityType:row.entity_type, displayName:row.display_name, pattern:row.normalized_pattern, matchType:row.match_type, exampleText:row.example_text, createdAt:row.created_at, byteSize:row.byte_size, iconUrl:`/api/icons/admin-assets/${row.storage_key}/128` })) });
});

router.get('/icon-rules', (_req, res) => {
  const rows = sqlite.prepare(`SELECT r.*, a.storage_key, a.byte_size FROM icon_rules r JOIN icon_assets a ON a.id=r.icon_asset_id WHERE r.status='approved' AND a.status='approved' ORDER BY r.entity_type, r.display_name`).all();
  res.json({ rules: rows.map(row => ({ id:row.id, entityType:row.entity_type, displayName:row.display_name, pattern:row.normalized_pattern, matchType:row.match_type, priority:row.priority, updatedAt:row.reviewed_at, byteSize:row.byte_size, iconUrl:`/api/icons/admin-assets/${row.storage_key}/128` })) });
});

router.patch('/icon-submissions/:id', (req, res) => {
  if (!['approved','rejected'].includes(req.body?.status)) return res.status(400).json({ error:'Choose approved or rejected.' });
  const rule = sqlite.prepare(`SELECT * FROM icon_rules WHERE id=? AND status='pending'`).get(req.params.id);
  if (!rule) return res.status(404).json({ error:'Submission not found.' });
  const now = new Date().toISOString();
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE icon_rules SET status=?, reviewed_by=?, reviewed_at=?, rejection_reason=? WHERE id=?`).run(req.body.status,req.user.userId,now,String(req.body.reason||'').slice(0,300)||null,rule.id);
    if (req.body.status === 'approved') sqlite.prepare(`UPDATE icon_assets SET status='approved', reviewed_by=?, reviewed_at=?, rejection_reason=NULL WHERE id=?`).run(req.user.userId,now,rule.icon_asset_id);
  })();
  if (req.body.status === 'rejected') {
    const asset = sqlite.prepare('SELECT storage_key FROM icon_assets WHERE id=?').get(rule.icon_asset_id);
    const used = sqlite.prepare(`SELECT count(*) count FROM icon_rules WHERE icon_asset_id=? AND status IN ('pending','approved')`).get(rule.icon_asset_id).count;
    if (!used && asset) {
      for (const size of [32,64,128]) { try { fs.unlinkSync(path.join(ICON_ASSET_ROOT, `${asset.storage_key}-${size}.webp`)); } catch {} }
      sqlite.prepare('DELETE FROM icon_assets WHERE id=?').run(rule.icon_asset_id);
    }
  }
  res.json({ id:rule.id, status:req.body.status });
});

router.get('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid user id is required' });

  const user = db.select({
    id: users.id,
    email: users.email,
    accountId: users.accountId,
    createdAt: users.createdAt,
    mfaEnabled: users.mfaEnabled,
    role: users.role,
    isActive: users.isActive,
    emailVerifiedAt: users.emailVerifiedAt,
    name: accounts.name,
  }).from(users).leftJoin(accounts, eq(users.accountId, accounts.id))
    .where(eq(users.id, id)).get();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const storedDevices = db.select().from(trustedDevices)
    .where(eq(trustedDevices.userId, id)).all()
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  const devices = await Promise.all(storedDevices.map(async ({ tokenHash, ...device }) => ({
      ...device,
      // A non-secret audit fingerprint. The full hash and browser token never leave the server.
      signature: `SHA-256 ${tokenHash.slice(0, 8)}…${tokenHash.slice(-8)}`,
      isExpired: device.expiresAt <= new Date().toISOString(),
      approximateLocation: await lookupIpLocation(device.lastIp),
    })));

  const connections = user.accountId
    ? db.select().from(simplefinConnections).where(eq(simplefinConnections.userId, user.accountId)).all()
    : [];

  res.json({
    user: {
      ...user,
      trustedDevices: devices,
      simplefin: {
        connectionCount: connections.length,
        cooldownCount: connections.filter(connection => connection.nextSyncAllowedAt).length,
        lastSuccessfulSyncAt: connections.map(connection => connection.lastSyncSucceededAt).filter(Boolean).sort().at(-1) || null,
      },
      betaFeatures: enabledFeatures(user.accountId),
    },
  });
});

router.patch('/users/:id/beta-features/:featureKey', (req, res) => {
  const id = Number(req.params.id);
  const featureKey = String(req.params.featureKey || '');
  if (!Number.isInteger(id) || !isKnownFeature(featureKey) || typeof req.body?.enabled !== 'boolean'
    || Object.keys(req.body || {}).some(key => key !== 'enabled')) {
    return res.status(400).json({ error: 'A valid user, beta feature, and enabled status are required.' });
  }
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target?.accountId) return res.status(404).json({ error: 'User account not found.' });
  const enabled = setFeature(target.accountId, featureKey, req.body.enabled, req.user.userId);
  return res.json({ featureKey, enabled, betaFeatures: enabledFeatures(target.accountId) });
});

router.delete('/users/:id/trusted-devices/:deviceId', (req, res) => {
  const id = Number(req.params.id);
  const deviceId = String(req.params.deviceId || '');
  if (!Number.isInteger(id) || !deviceId || deviceId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(deviceId)) {
    return res.status(400).json({ error: 'A valid user and device id are required' });
  }
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return res.status(404).json({ error: 'User not found' });
  const device = db.select().from(trustedDevices)
    .where(and(eq(trustedDevices.id, deviceId), eq(trustedDevices.userId, id))).get();
  if (!device) return res.status(404).json({ error: 'Trusted device not found' });
  db.delete(trustedDevices).where(and(eq(trustedDevices.id, deviceId), eq(trustedDevices.userId, id))).run();
  res.json({ ok: true, removedDeviceId: deviceId });
});

router.patch('/users/:id/simplefin/reset-sync-cooldown', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid user id is required' });
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (!target.accountId) return res.json({ connectionsUpdated: 0 });

  // Preserve the successful-sync timestamp and audit trail. Only remove the
  // one-hour throttle that prevents the customer from starting another sync.
  const result = db.update(simplefinConnections)
    .set({ nextSyncAllowedAt: null })
    .where(eq(simplefinConnections.userId, target.accountId)).run();
  res.json({ connectionsUpdated: result.changes });
});

router.patch('/users/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const { isActive } = req.body;
  if (!Number.isInteger(id) || typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'A valid user id and boolean isActive are required' });
  }
  if (id === req.user.userId && !isActive) {
    return res.status(400).json({ error: 'You cannot deactivate your own admin account' });
  }
  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (isActive && !target.emailVerifiedAt) {
    return res.status(409).json({ error: 'The user must verify their email before the account can be activated' });
  }
  db.update(users).set({ isActive }).where(eq(users.id, id)).run();
  res.json({ user: { id, isActive } });
});

router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'A valid user id is required' });
  if (id === req.user.userId) return res.status(400).json({ error: 'You cannot delete your own admin account' });

  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'admin') return res.status(403).json({ error: 'Administrator accounts cannot be deleted from the console' });
  if (target.isActive) return res.status(409).json({ error: 'Deactivate the account before permanently deleting it' });

  sqlite.transaction(() => {
    // User-owned authentication records cascade from users. Financial records
    // cascade from the account, so both roots must be removed atomically.
    db.delete(users).where(eq(users.id, id)).run();
    if (target.accountId) db.delete(accounts).where(eq(accounts.id, target.accountId)).run();
  })();
  res.json({ ok: true, deletedUserId: id });
});

module.exports = router;
