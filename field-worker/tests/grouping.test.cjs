const { test } = require('node:test');
const assert = require('node:assert/strict');
const { install } = require('../snapshot-group.cjs');

function fixture() {
  let builds = 0, validations = 0;
  const db = { async $transaction(work) { builds++; await new Promise(resolve => setTimeout(resolve, 15)); return work({}); } };
  const field = {
    async scope(user) { return { scope: 'block', fullBlock: true, blockId: user.blockId, round: 8, hours: 24, canEditStructure: false }; },
    currentRevision(user) { return { key: 'unused', entry: { value: Promise.resolve(user.revision || 'r1') } }; },
    async poll(user) {
      validations++;
      const scope = await this.scope(user);
      await this.currentRevision(user).entry.value;
      const value = await db.$transaction(async () => {
        if (user.fail) throw Error('snapshot failed');
        scope.round = 9; scope.hours = 12;
        return { cursor: 'r2', data: { workRoundNumber: 9, houses: [{ id: 1 }] } };
      }, { isolationLevel: 'RepeatableRead' });
      validations++;
      return { value, scope };
    },
  };
  const stats = install(field, db);
  return { field, db, stats, counts: () => ({ builds, validations }) };
}
const user = { tenantId: 1, territoryId: 2, blockId: 3, round: 8, roles: ['publisher'] };

test('coalesces the whole live transaction, but retains per-reader validation and isolated objects', async () => {
  const f = fixture();
  const [one, two] = await Promise.all([f.field.poll({ ...user, id: 'a' }), f.field.poll({ ...user, id: 'b' })]);
  assert.deepEqual(f.counts(), { builds: 1, validations: 4 });
  assert.deepEqual(one, two);
  assert.equal(two.scope.round, 9); assert.equal(two.scope.hours, 12);
  one.value.data.houses[0].id = 99;
  assert.equal(two.value.data.houses[0].id, 1);
  assert.equal(f.stats().pending, 0);
  await f.field.poll(user);
  assert.equal(f.counts().builds, 2, 'no completed-result cache');
});

test('never combines different tenants, territories, blocks, revisions or response roles', async () => {
  const f = fixture();
  const users = [user, { ...user, tenantId: 9 }, { ...user, territoryId: 9 },
    { ...user, blockId: 9 }, { ...user, revision: 'different' }, { ...user, roles: ['overseer'] }];
  await Promise.all(users.map(u => f.field.poll(u)));
  assert.equal(f.counts().builds, users.length);
});

test('shared failures are removed and unrelated transactions bypass grouping', async () => {
  const f = fixture();
  const failures = await Promise.allSettled([f.field.poll({ ...user, fail: true }), f.field.poll({ ...user, fail: true })]);
  assert(failures.every(value => value.status === 'rejected'));
  assert.equal(f.stats().pending, 0);
  await f.field.poll(user);
  assert.equal(f.counts().builds, 2);
  assert.equal(await f.db.$transaction(async () => 17), 17);
  assert.equal(f.stats().bypass, 1);
});
