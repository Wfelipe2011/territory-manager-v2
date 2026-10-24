import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { fieldFixture } from './utils/field-fixture';

describe('Sincronização HTTP e presença', () => {
  let app: INestApplication;
  let ctx: Awaited<ReturnType<typeof fieldFixture>>;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await cleanDatabase(app.get(PrismaService)); ctx = await fieldFixture(app); });
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const poll = (extra: Record<string, string> = {}) => request(app.getHttpServer()).get('/v1/field/sync').set('Authorization', `Bearer ${ctx.publisherAccess.token}`).query({ ...ctx.query, ...extra });

  it('retorna snapshot e propaga marcações a outra consulta pendente', async () => {
    const initial = await poll().expect(200);
    expect(initial.body.data.houses).toEqual([expect.objectContaining({ id: ctx.house.id, status: false })]);
    const writer = await createTestApp();
    const pending = poll({ cursor: initial.body.cursor, tabId: randomUUID() }).then(response => response);
    await wait(150);
    const started = Date.now();
    await request(writer.getHttpServer()).patch(ctx.patchPath).set('Authorization', `Bearer ${ctx.adminToken}`).send({ status: true, round: 1 }).expect(200);
    const changed = await pending;
    await writer.close();
    expect(Date.now() - started).toBeLessThan(3500);
    expect(changed.status).toBe(200);
    expect(changed.body.changed).toBe(true);
    expect(changed.body.data.houses[0].status).toBe(true);
  });

  it('reverte a revisão junto com a transação e entrega alterações administrativas sem cache antigo', async () => {
    const initial = await poll().expect(200);
    await expect(ctx.prisma.$transaction(async tx => { await tx.house.update({ where: { id: ctx.house.id }, data: { number: '99' } }); throw new Error('rollback'); })).rejects.toThrow('rollback');
    const unchanged = await poll().expect(200);
    expect(unchanged.body.cursor).toBe(initial.body.cursor);
    await ctx.prisma.house.update({ where: { id: ctx.house.id }, data: { number: '100' } });
    const changed = await poll().expect(200);
    expect(changed.body.cursor).not.toBe(initial.body.cursor);
    expect(changed.body.data.houses[0].number).toBe('100');
  });

  it('mantém a consulta aberta por 25 segundos quando não há alteração', async () => {
    const initial = await poll().expect(200);
    const start = Date.now();
    const heartbeat = await poll({ cursor: initial.body.cursor }).expect(200);
    expect(Date.now() - start).toBeGreaterThanOrEqual(24500);
    expect(heartbeat.body).toMatchObject({ changed: false, cursor: initial.body.cursor, presence: { total: 1 } });
    expect(heartbeat.body.data).toBeUndefined();
  }, 40000);

  it('deduplica abas do mesmo navegador e expira presença sem atividade', async () => {
    const one = await poll().expect(200);
    expect(one.body.presence.total).toBe(1);
    const sameBrowser = await poll({ tabId: randomUUID() }).expect(200);
    expect(sameBrowser.body.presence.total).toBe(1);
    const otherId = randomUUID();
    const two = await poll({ clientId: otherId, tabId: randomUUID() }).expect(200);
    expect(two.body.presence.total).toBe(2);
    await ctx.prisma.$executeRaw`UPDATE field_session SET last_seen_at = now() - interval '65 seconds' WHERE client_id = ${ctx.identity.clientId}`;
    const expired = await poll({ clientId: otherId, tabId: randomUUID() }).expect(200);
    expect(expired.body.presence.total).toBe(1);
  });

  it('interrompe consultas pendentes quando o dirigente revoga a quadra e não abre Socket.IO', async () => {
    const initial = await poll().expect(200);
    const pending = poll({ cursor: initial.body.cursor }).then(response => response);
    await wait(150);
    await request(app.getHttpServer()).delete(`/v1/territories/${ctx.territory.id}/blocks/${ctx.block.id}/signature`).set('Authorization', `Bearer ${ctx.leaderAccess.token}`).expect(200);
    expect((await pending).status).toBe(403);
    await request(app.getHttpServer()).get('/socket.io/?EIO=4&transport=polling').expect(404);
  });
});
