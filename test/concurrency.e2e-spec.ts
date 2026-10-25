import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { ConcurrencyService } from '../src/modules/dashboard/concurrency.service';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { fieldFixture } from './utils/field-fixture';

describe('Histórico persistente de simultaneidade HTTP', () => {
  let app: INestApplication;
  let service: ConcurrencyService;
  let ctx: Awaited<ReturnType<typeof fieldFixture>>;
  beforeAll(async () => {
    app = await createTestApp();
    service = app.get(ConcurrencyService);
    // Explicit collection makes tests deterministic, independent of the timer.
    await service.onModuleDestroy();
  });
  beforeEach(async () => { await cleanDatabase(app.get(PrismaService)); ctx = await fieldFixture(app); });
  afterAll(async () => { await app.close(); });
  const poll = (identity = ctx.identity) => request(app.getHttpServer()).get('/v1/field/sync')
    .set('Authorization', `Bearer ${ctx.publisherAccess.token}`).query({ ...ctx.query, ...identity });

  it('deduplica abas, exclui presença vencida/saída/link expirado e persiste total e congregação', async () => {
    await poll().expect(200);
    await poll({ ...ctx.identity, tabId: randomUUID() }).expect(200);
    const expired = { clientId: randomUUID(), tabId: randomUUID() };
    await poll(expired).expect(200);
    await ctx.prisma.$executeRaw`UPDATE field_session SET last_seen_at=now()-interval '61 seconds' WHERE client_id=${expired.clientId}`;
    const left = { clientId: randomUUID(), tabId: randomUUID() };
    await poll(left).expect(200);
    await ctx.prisma.$executeRaw`UPDATE field_session SET disconnected_at=now() WHERE client_id=${left.clientId}`;
    await service.collect();
    const data = await service.history();
    expect(data.online).toBe(1);
    expect(data.peak?.active).toBe(1);
    expect(data.sessionsGeneral[0]).toMatchObject({ average: 1, active: 1, samples: 1 });
    expect(data.sessionsByTenant[0]).toMatchObject({ tenantId: ctx.tenant.id, active: 1 });
    // A separate service instance can read the persisted history (no memory cache).
    expect((await new ConcurrencyService(ctx.prisma).history()).peak?.active).toBe(1);
    await ctx.prisma.signature.updateMany({ where: { tenantId: ctx.tenant.id }, data: { expirationDate: new Date(0) } });
    expect((await service.current()).find(r => r.scope_id === 0)?.active).toBe(0);
    // Historical peak must not change when current presence changes.
    expect((await service.history()).peak?.active).toBe(1);
  });

  it('coleta uma única vez por janela entre instâncias e grava zeros', async () => {
    const other = new ConcurrencyService(ctx.prisma);
    await Promise.all([service.collect(), other.collect(), service.collect()]);
    await service.collect();
    const data = await service.history();
    expect(data.sessionsGeneral[0]).toMatchObject({ average: 0, active: 0, samples: 1 });
    const [rollup] = await ctx.prisma.$queryRaw<{ samples: number; peak: number }[]>`SELECT samples,peak FROM field_concurrency_hour WHERE scope_id=0`;
    expect(rollup).toEqual({ samples: 1, peak: 0 });
  });

  it('consulta médias ponderadas, pico e horário depois da retenção de detalhes', async () => {
    await ctx.prisma.$executeRaw`INSERT INTO field_concurrency_sample VALUES (now()-interval '100 days',0,99)`;
    await ctx.prisma.$executeRaw`
      INSERT INTO field_concurrency_hour VALUES
      ('2025-01-01T10:00:00Z',0,2,10,8,'2025-01-01T10:00:30Z'),
      ('2025-01-01T11:00:00Z',0,1,2,2,'2025-01-01T11:00:00Z')`;
    await service.collect();
    const [{ count }] = await ctx.prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM field_concurrency_sample WHERE sampled_at<now()-interval '90 days'`;
    expect(count).toBe(0);
    const data = await service.history({ from: '2025-01-01', to: '2025-01-02', groupBy: '1d' });
    expect(data.resolutionSeconds).toBe(3600);
    expect(data.sessionsGeneral[0]).toMatchObject({ average: 4, active: 8, samples: 3 });
    expect(data.peak).toEqual({ active: 8, at: '2025-01-01T10:00:30.000Z' });
    expect(data.sessionsGeneral).toHaveLength(1); // No invented zero samples during outages.
    const rounded = await service.history({ from: '2025-01-01T10:15:00Z', to: '2025-01-01T11:15:00Z', groupBy: '10min' });
    expect(rounded.groupSeconds).toBe(3600);
    expect(rounded.from).toBe('2025-01-01T10:00:00.000Z');
    expect(rounded.to).toBe('2025-01-01T12:00:00.000Z');
    expect(rounded.peak?.active).toBe(8);
  });

  it('aceita filtro de 30 dias e rejeita datas incompletas, invertidas e períodos excessivos', async () => {
    await request(app.getHttpServer()).get('/v1/sessions?period=30d').expect(200);
    for (const query of ['from=2026-01-01', 'from=2026-02-01&to=2026-01-01', 'from=2020-01-01&to=2026-01-01', 'from=invalido&to=2026-01-01']) {
      await request(app.getHttpServer()).get(`/v1/sessions?${query}`).expect(400);
    }
  });
});
