const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), vm = require('node:vm');
test('unrelated scopes do not cause registration races; same-scope updates and disconnect do', async () => {
  const clients = [];
  class Client extends EventEmitter { constructor() { super(); clients.push(this); } async connect() {} async query() {} async end() { this.emit('end'); } }
  const sandbox = { module: { exports: {} }, require: () => ({ Client }), setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(require.resolve('../revision-listener.cjs'), 'utf8'), sandbox);
  const hub = sandbox.module.exports.create('postgresql://synthetic', () => {}); await hub.ready;
  const user = { tenantId: 1, territoryId: 2 }, scope = { blockId: 3 }, abort = new AbortController();
  const version = hub.version(user, scope);
  clients[0].emit('notification', { channel: 'field_revision_changed', payload: '[9,2,3]' });
  assert.equal(hub.version(user, scope), version);
  const waiting = hub.wait(user, scope, version, 1000, abort.signal);
  assert.equal(hub.stats().waiters, 1);
  clients[0].emit('notification', { channel: 'field_revision_changed', payload: '[1,2,3]' });
  await waiting; assert.equal(hub.stats().notifiedWaits, 1);
  await hub.wait(user, scope, version, 1000, abort.signal);
  assert.equal(hub.stats().registrationRaces, 1);
  const beforeLoss = hub.version(user, scope);
  clients[0].emit('error', Error('lost'));
  assert.notEqual(hub.version(user, scope), beforeLoss);
  await hub.close(); assert.equal(hub.stats().waiters, 0);
});
