const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
test('set-based rewrite matches the actual snapshot source and preserves its remaining SQL', () => {
  const base = { module: { exports: {} }, require: () => ({}) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../aggregate-snapshot.cjs'), 'utf8'), base);
  const optimized = { module: { exports: {} }, require: () => base.module.exports };
  vm.runInNewContext(fs.readFileSync(require.resolve('../experiments/sql-snapshot.cjs'), 'utf8'), optimized);
  assert(optimized.module.exports.SQL.includes('DISTINCT ON (house_id)'));
  assert(!optimized.module.exports.SQL.includes('LEFT JOIN LATERAL (SELECT id,completed'));
  assert.equal(optimized.module.exports.originalSQL, base.module.exports.SQL);
  assert(optimized.module.exports.SQL.includes("h.registration_status<>'rejected'"));
});
