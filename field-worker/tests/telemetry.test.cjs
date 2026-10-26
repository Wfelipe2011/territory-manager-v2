const { test } = require('node:test');
const assert = require('node:assert/strict');
const { response } = require('../telemetry.cjs');

test('telemetria interna exige chave e não aceita mutações', async () => {
  const metrics = { snapshot: () => ({ instanceId: 'qa', buckets: [] }) };
  for (const request of [new Request('http://worker/internal/metrics'), new Request('http://worker/internal/metrics', { headers: { 'x-api-key': 'wrong' } }), new Request('http://worker/internal/metrics', { method: 'POST', headers: { 'x-api-key': 'secret' } })]) {
    assert.equal(response(request, 'secret', metrics, {}).status, 403);
  }
  const result = response(new Request('http://worker/internal/metrics', { headers: { 'x-api-key': 'secret' } }), 'secret', metrics, { poolSize: 2 });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await result.json(), { metrics: metrics.snapshot(), health: { poolSize: 2 } });
});
