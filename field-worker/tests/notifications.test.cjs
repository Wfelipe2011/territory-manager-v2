const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), vm = require('node:vm');

function fixture() {
  const clients = [], invalidations = [];
  class Client extends EventEmitter {
    constructor() { super(); clients.push(this); this.queries = []; }
    async connect() {}
    async query(text) { this.queries.push(text); }
    async end() { this.emit('end'); }
  }
  const sandbox = { module: { exports: {} }, require(name) { assert.equal(name, 'pg'); return { Client }; }, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(require.resolve('../revision-listener.cjs'), 'utf8'), sandbox);
  const hub = sandbox.module.exports.create('postgresql://synthetic', scope => invalidations.push(scope));
  return { hub, clients, invalidations };
}
const user = { tenantId: 1, territoryId: 2 }, scope = { blockId: 3 };

test('notifications wake only matching scopes; timer and abort clean up waiters', async () => {
  const { hub, clients } = fixture(); await hub.ready;
  assert.deepEqual(clients[0].queries, ['LISTEN field_revision_changed']);
  const signal = new AbortController();
  const wait = hub.wait(user, scope, hub.version(user,scope), 1000, signal.signal);
  clients[0].emit('notification', { channel: 'field_revision_changed', payload: '[9,2,3]' });
  assert.equal(hub.stats().waiters, 1);
  clients[0].emit('notification', { channel: 'field_revision_changed', payload: '[1,2,3]' });
  await wait; assert.equal(hub.stats().notifiedWaits, 1);
  await hub.wait(user, scope, hub.version(user,scope), 2, signal.signal);
  assert.equal(hub.stats().timerWaits, 1);
  const aborted = hub.wait(user, scope, hub.version(user,scope), 1000, signal.signal);
  signal.abort(); await aborted; assert.equal(hub.stats().waiters, 0);
  await hub.close();
});

test('a notification between reading revision and registering a wait is not missed', async () => {
  const { hub, clients } = fixture(); await hub.ready;
  const before = hub.version(user,scope);
  clients[0].emit('notification', { channel: 'field_revision_changed', payload: '[1,2,3]' });
  await hub.wait(user, scope, before, 1000, new AbortController().signal);
  assert.equal(hub.stats().registrationRaces, 1);
  assert.equal(hub.stats().waiters, 0);
  await hub.close();
});

test('connection loss wakes readers, reconnects and invalidates revision cache', async () => {
  const { hub, clients, invalidations } = fixture(); await hub.ready;
  const waiting = hub.wait(user, scope, hub.version(user,scope), 3000, new AbortController().signal);
  clients[0].emit('error', Error('connection lost')); await waiting;
  assert.equal(hub.stats().connected, false);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(hub.stats().connected, true);
  assert.equal(hub.stats().reconnects, 1);
  assert.equal(clients.length, 2);
  assert(invalidations.length >= 3);
  await hub.close(); assert.equal(hub.stats().connected, false);
});
