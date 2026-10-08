const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { Router } = require('express');
const { sqlite } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { normalizeIconPattern } = require('../lib/iconResolver');
const { validateSvg } = require('../lib/safeSvg');

const router = Router();
const ROOT = path.join(__dirname, '../../data/icon-assets');
const MAX_PENDING = 50, MAX_PER_USER = 5, MAX_DAILY = 5, MAX_BYTES = 1024 * 1024, MAX_PIXELS = 1024 * 1024;
const MAX_NORMALIZED_BYTES = 200 * 1024;
fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
const ACCEPTED_ICON_TYPES = ['image/png','image/jpeg','image/webp','image/svg+xml'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 6 }, fileFilter: (_req, file, cb) => cb(null, ACCEPTED_ICON_TYPES.includes(file.mimetype)) });
const uploadLimiter = rateLimit({ windowMs: 24*60*60*1000, limit: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: req => `icon:${req.user?.accountId || ipKeyGenerator(req.ip)}` });
const customerUploadLimiter = (req, res, next) => req.user?.role === 'admin' ? next() : uploadLimiter(req, res, next);

async function prepareIcon(buffer) {
  const isSvg = /<svg\b/i.test(buffer.toString('utf8', 0, Math.min(buffer.length, 4096)));
  if (isSvg) validateSvg(buffer);
  const source = sharp(buffer, { animated: false, limitInputPixels: MAX_PIXELS });
  const metadata = await source.metadata();
  if (!['png','jpeg','webp','svg'].includes(metadata.format) || !metadata.width || !metadata.height || metadata.pages > 1) throw new Error('Invalid image');
  const normalized = await source.rotate().resize(128,128,{ fit:'contain', background:{r:0,g:0,b:0,alpha:0} }).webp({ quality: 82 }).toBuffer();
  const variants = {};
  for (const size of [32,64,128]) variants[size] = await sharp(normalized).resize(size,size).webp({ quality:82 }).toBuffer();
  if (Object.values(variants).reduce((total, variant) => total + variant.length, 0) > MAX_NORMALIZED_BYTES) throw new Error('Normalized icon is too large');
  return { hash: crypto.createHash('sha256').update(normalized).digest('hex'), normalized, variants };
}

function writeVariants(key, variants) {
  for (const size of [32,64,128]) fs.writeFileSync(path.join(ROOT, `${key}-${size}.webp`), variants[size], { mode: 0o600, flag: 'wx' });
}

function removeVariants(key) {
  for (const size of [32,64,128]) { try { fs.unlinkSync(path.join(ROOT, `${key}-${size}.webp`)); } catch {} }
}

router.get('/assets/:key/:size', (req, res) => {
  if (!/^[a-f0-9-]{36}$/.test(req.params.key) || !['32','64','128'].includes(req.params.size)) return res.status(404).end();
  const asset = sqlite.prepare(`SELECT 1 FROM icon_assets WHERE storage_key=? AND status='approved'`).get(req.params.key);
  if (!asset) return res.status(404).end();
  res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(path.join(ROOT, `${req.params.key}-${req.params.size}.webp`));
});
router.get('/admin-assets/:key/:size', requireAdmin, (req,res) => {
  if (!/^[a-f0-9-]{36}$/.test(req.params.key) || !['32','64','128'].includes(req.params.size)) return res.status(404).end();
  res.set({ 'Content-Type':'image/webp','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff' });
  res.sendFile(path.join(ROOT, `${req.params.key}-${req.params.size}.webp`));
});

router.post('/submissions', customerUploadLimiter, (req, res, next) => {
  const pending = sqlite.prepare(`SELECT count(*) count FROM icon_rules WHERE status='pending'`).get().count;
  const mine = sqlite.prepare(`SELECT count(*) count FROM icon_rules WHERE status='pending' AND submitted_by=?`).get(req.user.accountId).count;
  const daily = sqlite.prepare(`SELECT count(*) count FROM icon_rules WHERE submitted_by=? AND created_at>=?`).get(req.user.accountId, new Date(Date.now()-86400000).toISOString()).count;
  if (pending >= MAX_PENDING) return res.status(503).json({ error: 'The icon review queue is full. Try again after submissions are reviewed.' });
  if (req.user.role !== 'admin' && (mine >= MAX_PER_USER || daily >= MAX_DAILY)) return res.status(429).json({ error: 'You have reached the icon submission limit.' });
  next();
}, upload.single('icon'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a PNG, JPEG, WebP, or SVG image under 1 MB.' });
    const type = req.body.entityType;
    const allowedTypes = req.user.role === 'admin' ? ['merchant','institution','financial_product','category'] : ['merchant','institution','financial_product'];
    if (!allowedTypes.includes(type)) return res.status(400).json({ error: 'Choose a valid icon type.' });
    const displayName = String(req.body.displayName || '').trim().slice(0, 80);
    const pattern = normalizeIconPattern(req.body.pattern);
    const example = String(req.body.exampleText || '').trim().slice(0, 160);
    if (!displayName || pattern.length < 3) return res.status(400).json({ error: 'Company name and a meaningful pattern of at least 3 characters are required.' });
    const { hash, normalized, variants } = await prepareIcon(req.file.buffer);
    const now = new Date().toISOString();
    const existingAsset = sqlite.prepare('SELECT * FROM icon_assets WHERE content_hash=?').get(hash);
    const prepared = existingAsset ? null : { id: crypto.randomUUID(), key: crypto.randomUUID(), variants };
    if (prepared) {
      writeVariants(prepared.key, prepared.variants);
    }
    let result;
    try { result = sqlite.transaction(() => {
      if (sqlite.prepare(`SELECT count(*) count FROM icon_rules WHERE status='pending'`).get().count >= MAX_PENDING) throw Object.assign(new Error('Queue full'), { code: 'QUEUE_FULL' });
      let asset = sqlite.prepare('SELECT * FROM icon_assets WHERE content_hash=?').get(hash);
      if (!asset) {
        sqlite.prepare(`INSERT INTO icon_assets(id,content_hash,storage_key,byte_size,width,height,status,submitted_by,created_at) VALUES(?,?,?,?,?,?,'pending',?,?)`).run(prepared.id,hash,prepared.key,normalized.length,128,128,req.user.accountId,now);
        asset = { id:prepared.id, storage_key:prepared.key };
      }
      const ruleId = crypto.randomUUID();
      sqlite.prepare(`INSERT INTO icon_rules(id,icon_asset_id,entity_type,display_name,normalized_pattern,match_type,priority,status,submitted_by,example_text,created_at) VALUES(?,?,?,?,?,'contains',0,'pending',?,?,?)`).run(ruleId,asset.id,type,displayName,pattern,req.user.accountId,example,now);
      return ruleId;
    })(); } catch (error) {
      if (prepared) removeVariants(prepared.key);
      throw error;
    }
    res.status(201).json({ id: result, status: 'pending' });
  } catch (error) {
    if (error.code === 'QUEUE_FULL') return res.status(503).json({ error: 'The icon review queue is full.' });
    return res.status(400).json({ error: 'The image could not be safely processed. Use a still PNG, JPEG, WebP, or safe SVG. Raster images must be under 1 MB and 1024×1024; SVG files must be under 256 KB.' });
  } finally { if (req.file?.buffer) req.file.buffer.fill(0); }
});

router.patch('/admin-rules/:id', requireAdmin, upload.single('icon'), async (req, res) => {
  let prepared;
  try {
    const rule = sqlite.prepare(`SELECT r.*, a.storage_key FROM icon_rules r JOIN icon_assets a ON a.id=r.icon_asset_id WHERE r.id=? AND r.status='approved'`).get(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Approved icon rule not found.' });
    const allowedTypes = ['merchant','institution','financial_product','category'];
    const entityType = String(req.body.entityType || '');
    const displayName = String(req.body.displayName || '').trim().slice(0,80);
    const pattern = normalizeIconPattern(req.body.pattern);
    const matchType = String(req.body.matchType || 'contains');
    const priority = Number(req.body.priority);
    if (!allowedTypes.includes(entityType) || !displayName || pattern.length < 3 || !['exact','contains'].includes(matchType) || !Number.isInteger(priority) || priority < -100 || priority > 100) {
      return res.status(400).json({ error: 'Enter a valid type, name, pattern, match method, and priority from -100 to 100.' });
    }
    let replacement = null;
    if (req.file) {
      const processed = await prepareIcon(req.file.buffer);
      const existing = sqlite.prepare('SELECT * FROM icon_assets WHERE content_hash=?').get(processed.hash);
      prepared = existing ? null : { id:crypto.randomUUID(), key:crypto.randomUUID(), variants:processed.variants };
      if (prepared) writeVariants(prepared.key, prepared.variants);
      replacement = { existing, prepared, normalizedLength:processed.normalized.length, hash:processed.hash };
    }
    const now = new Date().toISOString();
    let oldAsset;
    try {
      oldAsset = sqlite.transaction(() => {
        let assetId = rule.icon_asset_id;
        if (replacement) {
          if (replacement.existing) {
            assetId = replacement.existing.id;
            sqlite.prepare(`UPDATE icon_assets SET status='approved', reviewed_by=?, reviewed_at=?, rejection_reason=NULL WHERE id=?`).run(req.user.userId,now,assetId);
          } else {
            sqlite.prepare(`INSERT INTO icon_assets(id,content_hash,storage_key,byte_size,width,height,status,submitted_by,reviewed_by,created_at,reviewed_at) VALUES(?,?,?,?,?,?,'approved',?,?,?,?)`).run(replacement.prepared.id,replacement.hash,replacement.prepared.key,replacement.normalizedLength,128,128,req.user.accountId,req.user.userId,now,now);
            assetId = replacement.prepared.id;
          }
        }
        sqlite.prepare(`UPDATE icon_rules SET icon_asset_id=?, entity_type=?, display_name=?, normalized_pattern=?, match_type=?, priority=?, reviewed_by=?, reviewed_at=? WHERE id=?`).run(assetId,entityType,displayName,pattern,matchType,priority,req.user.userId,now,rule.id);
        return assetId === rule.icon_asset_id ? null : { id:rule.icon_asset_id, key:rule.storage_key };
      })();
    } catch (error) {
      if (prepared) removeVariants(prepared.key);
      throw error;
    }
    if (oldAsset && !sqlite.prepare(`SELECT 1 FROM icon_rules WHERE icon_asset_id=? AND status IN ('pending','approved') LIMIT 1`).get(oldAsset.id)) {
      sqlite.prepare('DELETE FROM icon_assets WHERE id=?').run(oldAsset.id);
      removeVariants(oldAsset.key);
    }
    res.json({ id:rule.id, updatedAt:now });
  } catch (error) {
    res.status(400).json({ error: 'The icon rule or replacement image could not be updated safely.' });
  } finally { if (req.file?.buffer) req.file.buffer.fill(0); }
});

module.exports = router;
module.exports.ICON_ASSET_ROOT = ROOT;
