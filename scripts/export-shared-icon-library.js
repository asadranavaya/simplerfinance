#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

if (!process.argv.includes('--acknowledge-redistribution-rights')) {
  console.error('Refusing to export uploads without --acknowledge-redistribution-rights.');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const databasePath = process.env.BUDGET_DB_PATH
  ? path.resolve(process.env.BUDGET_DB_PATH)
  : path.join(root, 'data/budget.db');
const sourceRoot = path.join(root, 'data/icon-assets');
const outputRoot = path.join(root, 'library/icons');
const rulesPath = path.join(root, 'library/rules.json');
const manifestPath = path.join(root, 'library/manifest.json');
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

fs.mkdirSync(outputRoot, { recursive: true });
for (const file of fs.readdirSync(outputRoot)) {
  if (/\.webp$/i.test(file)) fs.unlinkSync(path.join(outputRoot, file));
}

const db = new Database(databasePath, { readonly: true });
const rows = db.prepare(`
  SELECT r.id, r.entity_type, r.display_name, r.normalized_pattern, r.match_type,
         r.priority, r.reviewed_at, a.storage_key
  FROM icon_rules r
  JOIN icon_assets a ON a.id = r.icon_asset_id
  WHERE r.status = 'approved' AND a.status = 'approved'
  ORDER BY r.entity_type, r.display_name, r.id
`).all();

const usedIds = new Set();
const rules = rows.map(row => {
  const baseId = `${row.entity_type}.${slug(row.display_name)}.${slug(row.normalized_pattern)}`;
  let id = baseId;
  for (let suffix = 2; usedIds.has(id); suffix += 1) id = `${baseId}.${suffix}`;
  usedIds.add(id);
  const variants = {};
  for (const size of [32, 64, 128]) {
    const source = path.join(sourceRoot, `${row.storage_key}-${size}.webp`);
    if (!fs.existsSync(source)) throw new Error(`Missing normalized icon variant: ${source}`);
    const contents = fs.readFileSync(source);
    const filename = `${id}-${size}.webp`;
    fs.copyFileSync(source, path.join(outputRoot, filename));
    variants[size] = { file: filename, sha256: hash(contents), byteSize: contents.length };
  }
  return {
    id,
    entityType: row.entity_type,
    displayName: row.display_name,
    pattern: row.normalized_pattern,
    matchType: row.match_type,
    priority: row.priority,
    variants,
    license: 'Third-party or community-provided artwork; no trademark rights granted',
    source: 'Bundled from an administrator-approved SimplerFinance v1 library submission',
    updatedAt: row.reviewed_at || new Date().toISOString(),
  };
});

const generatedAt = new Date().toISOString();
fs.writeFileSync(rulesPath, `${JSON.stringify({ schemaVersion: 1, rules }, null, 2)}\n`);
fs.writeFileSync(manifestPath, `${JSON.stringify({
  schemaVersion: 1,
  libraryVersion: '1.0.0',
  generatedAt,
  rules: 'rules.json',
  iconsBaseUrl: 'icons/',
  signature: null,
}, null, 2)}\n`);
console.log(`Exported ${rules.length} approved rules and ${rules.length * 3} normalized icon variants.`);
