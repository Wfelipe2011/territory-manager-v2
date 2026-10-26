import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { MonitoringService } from '../src/modules/monitoring/monitoring.service';
import { RequestMetrics } from '../src/modules/monitoring/request-metrics';

describe('Monitoramento agregado superadmin', () => {
  let app: INestApplication, prisma: PrismaService, monitoring: MonitoringService;
  const token = () => createTestToken({ roles: ['super_admin'] });
  const originalFetch = global.fetch, originalUrl = process.env.FIELD_WORKER_INTERNAL_URL, originalKey = process.env.API_KEY_SECRET;
  beforeAll(async () => { app = await createTestApp(); prisma = app.get(PrismaService); monitoring = app.get(MonitoringService); });
  beforeEach(async () => { await cleanDatabase(prisma); });
  afterEach(() => { global.fetch = originalFetch; if (originalUrl === undefined) delete process.env.FIELD_WORKER_INTERNAL_URL; else process.env.FIELD_WORKER_INTERNAL_URL = originalUrl; if (originalKey === undefined) delete process.env.API_KEY_SECRET; else process.env.API_KEY_SECRET = originalKey; });
  afterAll(async () => { await app.close(); });

  it('protege a rota técnica e valida as janelas', async () => {
    await request(app.getHttpServer()).get('/v1/dashboard/monitoring').expect(401);
    await request(app.getHttpServer()).get('/v1/dashboard/monitoring').set('Authorization', `Bearer ${createTestToken()}`).expect(403);
    await request(app.getHttpServer()).get('/v1/dashboard/monitoring?period=year').set('Authorization', `Bearer ${token()}`).expect(400);
    const res = await request(app.getHttpServer()).get('/v1/dashboard/monitoring').set('Authorization', `Bearer ${token()}`).expect(200);
    expect(res.body.summary.p95Ms).toBeNull();
    expect(res.body.collection.retentionDays).toBe(7);
  });
  it('upsert é idempotente entre coletores e não deixa uma amostra velha substituir a nova', async () => {
    const first = new RequestMetrics('api'), second = new RequestMetrics('api');
    first.record('write', 100, 200); const old = first.snapshot().buckets;
    await monitoring.persist(old); await monitoring.persist(old);
    first.record('write', 300, 500); await monitoring.persist(first.snapshot().buckets); await monitoring.persist(old);
    second.record('write', 200, 200); await monitoring.persist(second.snapshot().buckets);
    const report = await monitoring.report('15m');
    expect(report.summary).toMatchObject({ requests: 3, errors: 1, averageMs: 200, p95Ms: 500 });
    expect(report.categories).toHaveLength(1);
  });
  it('separa os 25 segundos do polling, mantém lacunas e dispara alertas somente com volume suficiente', async () => {
    const metrics = new RequestMetrics('worker');
    metrics.record('field_poll', 25000, 200);
    for (let i = 0; i < 20; i++) metrics.record('field_initial', 1500, i === 0 ? 503 : 200);
    await monitoring.persist(metrics.snapshot().buckets);
    const report = await monitoring.report('15m');
    expect(report.summary).toMatchObject({ requests: 20, errors: 1, p95Ms: 2500 });
    expect(report.polling).toMatchObject({ requests: 1, averageMs: 25000 });
    expect(report.alerts.map(alert => alert.kind)).toEqual(expect.arrayContaining(['latency', 'errors']));
    expect(report.series).toHaveLength(2);
  });
  it('observa listener degradado, indisponibilidade e retenção de sete dias', async () => {
    process.env.FIELD_WORKER_INTERNAL_URL = 'http://worker.test'; process.env.API_KEY_SECRET = 'qa-secret';
    const metrics = new RequestMetrics('worker'); metrics.record('field_initial', 10, 200);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ metrics: metrics.snapshot(), health: { readModelEnabled: true, listenerConnected: false, poolSize: 2, poolTotal: 2, poolIdle: 1, poolWaiting: 0, activeRequests: 0 } }) });
    const old = { ...metrics.snapshot().buckets[0], bucketAt: new Date(Date.now() - 8 * 86400000).toISOString() };
    await monitoring.persist([old]); await monitoring.collect();
    expect((await monitoring.report()).services.worker.state).toBe('degraded');
    const counts = await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM request_metric_minute WHERE bucket_at < now()-interval '7 days'`;
    expect(counts[0].count).toBe(0);
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')); await monitoring.collect();
    expect((await monitoring.report()).services.worker.state).toBe('unavailable');
  });
});
