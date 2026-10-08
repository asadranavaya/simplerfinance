const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sqlite } = require('../server/db');
const { matchRule } = require('../server/lib/iconResolver');
const { seedSharedIconLibrary } = require('../server/lib/sharedIconLibrary');

test('bundled v1 icon rules are imported without customer or reviewer metadata', () => {
  const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, '../library/rules.json'), 'utf8')).rules;
  const imported = sqlite.prepare(`SELECT * FROM icon_rules WHERE submitted_by IS NULL AND reviewed_by IS NULL`).all();
  assert.equal(imported.length, bundled.length);
  assert.ok(imported.every(rule => rule.priority <= -50));
  assert.equal(matchRule('merchant', 'DISCORD SERVER BOOST')?.alt, 'DISCORD');
  assert.equal(matchRule('institution', 'American Express National Bank')?.alt, 'Amex');
});

test('bundled v1 icon import is idempotent', () => {
  const before = sqlite.prepare('SELECT count(*) count FROM icon_rules').get().count;
  const result = seedSharedIconLibrary(sqlite);
  const after = sqlite.prepare('SELECT count(*) count FROM icon_rules').get().count;
  assert.equal(result.imported, 0);
  assert.equal(after, before);
});
