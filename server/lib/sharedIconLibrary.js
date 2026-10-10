'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const libraryRoot = path.join(projectRoot, 'library');
const runtimeRoot = path.join(projectRoot, 'data/icon-assets');
const allowedTypes = new Set(['merchant', 'institution', 'financial_product', 'category']);
const allowedMatches = new Set(['exact', 'contains']);
const uuidFrom = value => {
  const hex = crypto.createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
};
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

function copyAssetIfMissing(source, destination) {
  try {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    // Database initialization can run in parallel (for example, in Node's test
    // workers). Another process winning this exclusive copy is a successful seed.
    if (error.code !== 'EEXIST') throw error;
  }
}

function readLibrary() {
  const document = JSON.parse(fs.readFileSync(path.join(libraryRoot, 'rules.json'), 'utf8'));
  if (document.schemaVersion !== 1 || !Array.isArray(document.rules) || document.rules.length > 5000) {
    throw new Error('Unsupported shared icon library.');
  }
  return document.rules;
}

function validateRule(rule) {
  if (!rule || typeof rule.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,79}$/.test(rule.id)) throw new Error('Invalid library rule ID.');
  if (!allowedTypes.has(rule.entityType) || !allowedMatches.has(rule.matchType)) throw new Error(`Invalid library rule ${rule.id}.`);
  if (typeof rule.displayName !== 'string' || !rule.displayName || rule.displayName.length > 80) throw new Error(`Invalid display name for ${rule.id}.`);
  if (typeof rule.pattern !== 'string' || rule.pattern.length < 3 || rule.pattern.length > 120) throw new Error(`Invalid pattern for ${rule.id}.`);
  if (!Number.isInteger(rule.priority) || rule.priority < -100 || rule.priority > 100) throw new Error(`Invalid priority for ${rule.id}.`);
  for (const size of [32, 64, 128]) {
    const variant = rule.variants?.[size];
    if (!variant || !/^[a-z0-9][a-z0-9._-]{1,159}\.webp$/.test(variant.file) || !/^[a-f0-9]{64}$/.test(variant.sha256)) throw new Error(`Invalid ${size}px variant for ${rule.id}.`);
    const filename = path.join(libraryRoot, 'icons', variant.file);
    const contents = fs.readFileSync(filename);
    if (contents.length !== variant.byteSize || sha256(contents) !== variant.sha256) throw new Error(`Checksum mismatch for ${variant.file}.`);
  }
}

function seedSharedIconLibrary(sqlite) {
  if (!fs.existsSync(path.join(libraryRoot, 'rules.json'))) return { imported: 0, skipped: 0 };
  const rules = readLibrary();
  rules.forEach(validateRule);
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  const now = new Date().toISOString();
  let imported = 0;
  let skipped = 0;
  sqlite.transaction(() => {
    for (const rule of rules) {
      const equivalent = sqlite.prepare(`SELECT 1 FROM icon_rules WHERE status='approved' AND entity_type=? AND normalized_pattern=? AND match_type=? LIMIT 1`).get(rule.entityType, rule.pattern, rule.matchType);
      if (equivalent) { skipped += 1; continue; }
      const canonical = fs.readFileSync(path.join(libraryRoot, 'icons', rule.variants[128].file));
      const contentHash = sha256(canonical);
      let asset = sqlite.prepare('SELECT id, storage_key FROM icon_assets WHERE content_hash=?').get(contentHash);
      if (!asset) {
        asset = { id: uuidFrom(`library-asset:${contentHash}`), storage_key: uuidFrom(`library-storage:${contentHash}`) };
        for (const size of [32, 64, 128]) {
          const source = path.join(libraryRoot, 'icons', rule.variants[size].file);
          const destination = path.join(runtimeRoot, `${asset.storage_key}-${size}.webp`);
          copyAssetIfMissing(source, destination);
          fs.chmodSync(destination, 0o600);
        }
        sqlite.prepare(`INSERT INTO icon_assets(id,content_hash,storage_key,byte_size,width,height,status,created_at,reviewed_at) VALUES(?,?,?,?,128,128,'approved',?,?)`).run(asset.id, contentHash, asset.storage_key, canonical.length, now, now);
      }
      sqlite.prepare(`INSERT INTO icon_rules(id,icon_asset_id,entity_type,display_name,normalized_pattern,match_type,priority,status,created_at,reviewed_at) VALUES(?,?,?,?,?,?,?,'approved',?,?)`).run(
        uuidFrom(`library-rule:${rule.id}`), asset.id, rule.entityType, rule.displayName, rule.pattern, rule.matchType,
        Math.max(-100, rule.priority - 50), now, now,
      );
      imported += 1;
    }
  })();
  return { imported, skipped };
}

module.exports = { seedSharedIconLibrary };
