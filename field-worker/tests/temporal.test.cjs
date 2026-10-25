const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deadline, finalize } = require('../snapshot-group.cjs');
test('a shared snapshot cannot extend the unmark window or signature expiry for a waiting follower', () => {
  const snapshot = { data: { block: { signature: { expirationDate: new Date(100) } }, streets: [{ houses: [
    { canUnmarkUntil: new Date(200), blockedReason: null, canUnmark: true },
    { canUnmarkUntil: new Date(200), blockedReason: 'dont_visit', canUnmark: false },
  ] }] } };
  assert.equal(deadline(snapshot), 100);
  finalize(snapshot, 250);
  assert.equal(snapshot.data.block.signature, null);
  assert.equal(snapshot.data.streets[0].houses[0].canUnmark, false);
  assert.equal(snapshot.data.streets[0].houses[0].blockedReason, 'unmark_window_expired');
  assert.equal(snapshot.data.streets[0].houses[1].blockedReason, 'dont_visit');
});
