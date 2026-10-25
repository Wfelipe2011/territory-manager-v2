const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configure } = require('../runtime.cjs');
const environment = () => ({ DATABASE_URL: 'postgresql://user:pass@db/local?schema=public', JWT_SECRET: 'test', API_KEY_SECRET: 'test' });

test('defaults to two connections and a three-second revision check', () => {
  const env = environment();
  assert.deepEqual(configure(env), { poolSize: 2, checkIntervalMs: 3000, port: 3402 });
  assert.equal(new URL(env.DATABASE_URL).searchParams.get('connection_limit'), '2');
  assert.equal(env.FIELD_POLL_CHECK_MS, '3000');
});

test('explicit configuration controls the actual pool, not a stale URL parameter', () => {
  const env = { ...environment(), FIELD_DB_POOL_SIZE: '1', FIELD_POLL_CHECK_MS: '5000', PORT: '9000' };
  env.DATABASE_URL += '&connection_limit=10';
  assert.deepEqual(configure(env), { poolSize: 1, checkIntervalMs: 5000, port: 9000 });
  assert.equal(new URL(env.DATABASE_URL).searchParams.get('connection_limit'), '1');
});

test('refuses missing secrets, unsupported schemas and invalid numeric values', () => {
  for (const values of [{ JWT_SECRET: '' }, { API_KEY_SECRET: '' }, { FIELD_DB_POOL_SIZE: '0' },
    { FIELD_DB_POOL_SIZE: 'NaN' }, { FIELD_POLL_CHECK_MS: '25001' }, { PORT: '-1' },
    { DATABASE_URL: 'postgresql://user:pass@db/local?schema=private' }]) {
    assert.throws(() => configure({ ...environment(), ...values }));
  }
});
