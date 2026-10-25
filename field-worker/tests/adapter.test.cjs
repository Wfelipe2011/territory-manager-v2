const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(models = []) {
  const calls = [];
  let released = false;
  const client = {
    async query(statement, values) {
      const text = typeof statement === 'string' ? statement : statement.text;
      calls.push({ target: 'client', text, values: values || statement.values });
      if (text.includes('force_failure')) throw Error('synthetic failure');
      return { rows: [], rowCount: 1 };
    },
    release() { released = true; },
  };
  class Pool {
    on() {}
    async query(statement, values) { calls.push({ target: 'pool', text: statement.text || statement, values: values || statement.values }); return { rows: [], rowCount: 1 }; }
    async connect() { return client; }
    async end() {}
  }
  const sandbox = { module: { exports: {} }, URL, Date, console, performance, process: {env: {}},
    require(name) {
      if (['./snapshot-queries.cjs', './aggregate-snapshot.cjs', './validation-query.cjs'].includes(name)) return require('../' + name.slice(2));
      assert.equal(name, 'pg'); return { Pool, types: { setTypeParser() {} } };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pg-adapter.cjs'), 'utf8'), sandbox);
  return { db: sandbox.module.exports('postgresql://load:password@db/test?connection_limit=2', models), calls, released: () => released };
}

test('heartbeat operations stay lazy and use one transaction connection', async () => {
  const { db, calls, released } = fixture();
  const first = db.$executeRaw`UPDATE field_session SET disconnected_at=now() WHERE client_id=${"quote' OR TRUE"}`;
  const second = db.$executeRaw`INSERT INTO field_session(client_id) VALUES(${"quoted'"})`;
  assert.equal(calls.length, 0);
  const result = await db.$transaction([first, second]);
  assert.equal(result.join(','), '1,1');
  assert(calls.every(call => call.target === 'client'));
  assert.equal(calls[0].text, 'BEGIN ISOLATION LEVEL READ COMMITTED');
  assert.equal(calls.at(-1).text, 'COMMIT');
  assert(!calls[1].text.includes('OR TRUE'));
  assert.equal(calls[1].values[0], "quote' OR TRUE");
  assert(released());
});

test('a failed second heartbeat statement rolls back and releases', async () => {
  const { db, calls, released } = fixture();
  await assert.rejects(db.$transaction([
    db.$executeRaw`UPDATE field_session SET disconnected_at=now()`,
    db.$executeRaw`INSERT INTO field_session(force_failure) VALUES(${1})`,
  ]), /synthetic failure/);
  assert.equal(calls.at(-1).text, 'ROLLBACK');
  assert(!calls.some(call => call.text === 'COMMIT'));
  assert(released());
});

test('raw presence fragments are flattened with parameter numbering preserved', async () => {
  const { db, calls } = fixture();
  const fragment = { strings: ['AND block_id=', ''], values: [42] };
  await db.$transaction(async tx => tx.$queryRaw`SELECT client_id FROM field_session WHERE tenant_id=${7} ${fragment}`,
    { isolationLevel: 'RepeatableRead' });
  assert.equal(calls[0].text, 'BEGIN ISOLATION LEVEL REPEATABLE READ');
  assert.equal(calls[1].text, 'SELECT client_id FROM field_session WHERE tenant_id=$1 AND block_id=$2');
  assert.equal(calls[1].values.join(','), '7,42');
});

test('raw writes outside presence are refused', () => {
  const { db } = fixture();
  assert.throws(() => db.$executeRaw`DELETE FROM house`, /Unsupported raw operation/);
});

test('Date parameters use UTC, not process-local timestamp components', async () => {
  const { db, calls } = fixture([{ name: 'signature', uniqueIndexes: [], fields: [
    { name: 'id', kind: 'scalar', isId: true },
    { name: 'expirationDate', dbName: 'expiration_date', kind: 'scalar' },
  ] }]);
  const instant = new Date('2026-10-25T12:30:00.000Z');
  await db.$queryRaw`SELECT expiration_date FROM signature WHERE expiration_date>${instant}`;
  assert.equal(calls[0].text, 'SELECT expiration_date FROM signature WHERE expiration_date>$1');
  // A string is deliberate: pg Date serialization would reintroduce local TZ.
  // Result parser normalization alone is NOT sufficient for expiration filters.
  assert.equal(calls[0].values[0], '2026-10-25T12:30:00.000Z');
  await db.signature.findFirst({ where: { expirationDate: { gt: instant } }, select: { id: true } });
  assert.equal(calls[1].values[0], '2026-10-25T12:30:00.000Z');
});
