import { RequestMetrics, requestCategory, summarizeMetrics } from './request-metrics';

describe('Telemetria de requisições', () => {
  it('separa espera, sincronização inicial, entrada e operações sem guardar URLs', () => {
    expect(requestCategory('GET', '/v1/field/blocks/5/sync?cursor=secret')).toBe('field_poll');
    expect(requestCategory('GET', '/v1/field/sync?clientId=secret')).toBe('field_initial');
    expect(requestCategory('GET', '/v1/signature/secret')).toBe('access');
    expect(requestCategory('PATCH', '/v1/houses/10')).toBe('write');
    expect(requestCategory('GET', '/v1/dashboard/monitoring')).toBeNull();
  });
  it('calcula média ponderada e p95 por histogramas, sem misturar cancelamentos e 5xx', () => {
    const metrics = new RequestMetrics('api');
    for (let i = 0; i < 19; i++) metrics.record('write', 80, 200);
    metrics.record('write', 1500, 503);
    metrics.record('write', 24000, 200, true);
    expect(summarizeMetrics(metrics.snapshot().buckets)).toMatchObject({ requests: 20, errors: 1, errorRate: 5, aborted: 1, averageMs: 151, p95Ms: 100 });
  });
  it('retém somente quinze minutos em memória e devolve cópias dos histogramas', () => {
    const metrics = new RequestMetrics('worker');
    metrics.record('field_poll', 25000, 200, false, Date.now() - 16 * 60000);
    metrics.record('field_initial', 10, 200);
    const result = metrics.snapshot();
    expect(result.buckets).toHaveLength(1);
    result.buckets[0].histogram[0] = 100;
    expect(metrics.snapshot().buckets[0].histogram[0]).toBe(0);
  });
  it('pode ser desabilitada e ausência de amostras não vira latência zero', () => {
    const metrics = new RequestMetrics('api', false);
    metrics.record('read', 10, 200);
    expect(metrics.snapshot().buckets).toEqual([]);
    expect(summarizeMetrics([])).toMatchObject({ requests: 0, averageMs: null, p95Ms: null, errorRate: null });
  });
});
