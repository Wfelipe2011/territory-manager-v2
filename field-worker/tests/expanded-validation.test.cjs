const { test } = require('node:test');
const assert = require('node:assert/strict');
const create = require('../validation-query.cjs');
const user = { id: 'synthetic-link', tenantId: 1, territoryId: 2, blockId: 3, round: 8, roles: ['publisher'] };
const args = u => ({ where: { key: u.id, tenantId: u.tenantId, expirationDate: { gt: new Date() } } });
test('same-link concurrent database reads share only a live query; next call sees revocation', async () => {
  const validation = create(); let release, calls = 0, revoked = false;
  const connection = { async query() { calls++; await new Promise(resolve => { release = resolve; }); return { rows: revoked ? [] : [{ id: 1, token: 'private', expirationDate: new Date(Date.now() + 60000), _territory: { id: 2 }, _link: { id: 3 } }] }; } };
  const invoke = () => validation.run(user, () => validation.load(connection, 'signature', args(user)));
  const a = invoke(), b = invoke(); await Promise.resolve(); release();
  const [one, two] = await Promise.all([a, b]);
  assert.equal(calls, 1); assert.notEqual(one[0], two[0]);
  revoked = true; const c = invoke(); await Promise.resolve(); release();
  assert.deepEqual(await c, []); assert.equal(calls, 2);
  assert.equal(validation.stats().invocations, validation.stats().statements + validation.stats().followers);
  assert.equal(validation.stats().pending, 0);
});
test('different tenants, links and roles are not grouped; expired responses are refused', async () => {
  const validation = create(); let calls = 0;
  const connection = { async query() { calls++; return { rows: [{ expirationDate: new Date(Date.now() - 1) }] }; } };
  const users = [user, { ...user, tenantId: 4 }, { ...user, id: 'other-link' }, { ...user, roles: ['overseer'] }];
  const values = await Promise.all(users.map(u => validation.run(u, () => validation.load(connection, 'signature', args(u)))));
  assert.equal(calls, 4); assert(values.every(v => v.length === 0));
});
