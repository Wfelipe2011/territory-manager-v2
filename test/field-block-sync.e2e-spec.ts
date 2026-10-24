import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { fieldFixture } from './utils/field-fixture';

describe('Quadra completa e permissões das casas', () => {
  let app: INestApplication;
  let ctx: Awaited<ReturnType<typeof fieldFixture>>;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await cleanDatabase(app.get(PrismaService)); ctx = await fieldFixture(app); });
  const path = () => `/v1/field/blocks/${ctx.block.id}/sync`;
  const poll = (cursor?: string) => request(app.getHttpServer()).get(path()).set('Authorization', `Bearer ${ctx.publisherAccess.token}`).query({ ...ctx.identity, ...(cursor ? { cursor } : {}) });
  const house = (response: request.Response) => response.body.data.streets.find(street => street.id === ctx.address.id).houses[0];

  it('entrega todas as ruas com casas e inclui ruas vazias sem duplicar o conteúdo', async () => {
    const tb = await ctx.prisma.territory_block.findFirstOrThrow({ where: { blockId: ctx.block.id, territoryId: ctx.territory.id } });
    const empty = await ctx.prisma.address.create({ data: { name: 'Rua vazia', tenantId: ctx.tenant.id } });
    await ctx.prisma.territory_block_address.create({ data: { tenantId: ctx.tenant.id, territoryBlockId: tb.id, addressId: empty.id } });
    const response = await poll().expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.streets).toHaveLength(2);
    expect(response.body.data.streets).toEqual(expect.arrayContaining([expect.objectContaining({ id: empty.id, houses: [], firstNumber: null, lastNumber: null })]));
    expect(house(response)).toMatchObject({ id: ctx.house.id, canMark: true, canUnmark: false, blockedReason: null });
    for (const key of ['houses', 'blocks', 'street']) expect(response.body.data).not.toHaveProperty(key);
    expect(house(response)).not.toHaveProperty('address');
  });

  it('mantém os bloqueios de quadra, congregação e acesso revogado', async () => {
    await request(app.getHttpServer()).get(`/v1/field/blocks/${ctx.block.id + 1000}/sync`).set('Authorization', `Bearer ${ctx.publisherAccess.token}`).query(ctx.identity).expect(403);
    await request(app.getHttpServer()).get(path()).set('Authorization', `Bearer ${ctx.publisherAccess.token}`).query({ ...ctx.identity, territoryId: ctx.territory.id + 1 }).expect(403);
    await ctx.signatures.deleteBlockSignature(ctx.territory.id, ctx.block.id, ctx.tenant.id, 1);
    await poll().expect(403);
  });

  it('acorda uma consulta pendente quando outra instância altera uma casa', async () => {
    const initial = await poll().expect(200);
    const writer = await createTestApp();
    try {
      const pending = poll(initial.body.cursor).then(value => value);
      await new Promise(resolve => setTimeout(resolve, 150));
      await request(writer.getHttpServer()).patch(ctx.patchPath).set('Authorization', `Bearer ${ctx.adminToken}`).send({ status: true, round: 1 }).expect(200);
      const changed = await pending;
      expect(changed.status).toBe(200);
      expect(changed.body.cursor).not.toBe(initial.body.cursor);
      expect(house(changed)).toMatchObject({ status: true, canMark: false, canUnmark: true });
    } finally { await writer.close(); }
  });

  it('recalcula bloqueios e recusa uma escrita cuja permissão mudou após a leitura', async () => {
    expect(house(await poll())).toMatchObject({ canMark: true });
    for (const [data, reason] of [[{ dontVisit: true }, 'dont_visit']] as const) {
      await ctx.prisma.house.update({ where: { id: ctx.house.id }, data });
      expect(house(await poll())).toMatchObject({ canMark: false, canUnmark: false, blockedReason: reason });
      await request(app.getHttpServer()).patch(ctx.patchPath).set('Authorization', `Bearer ${ctx.publisherAccess.token}`).send({ status: true, round: 1 }).expect(403);
    }
    await ctx.prisma.house.update({ where: { id: ctx.house.id }, data: { dontVisit: false, reportType: 'update' } });
    expect(house(await poll())).toMatchObject({ canMark: true, blockedReason: null });
    await ctx.prisma.round.updateMany({ where: { houseId: ctx.house.id }, data: { endDate: new Date() } });
    expect(house(await poll())).toMatchObject({ canMark: false, blockedReason: 'closed_round' });
    await ctx.prisma.round.updateMany({ where: { houseId: ctx.house.id }, data: { endDate: null, completed: true, completedDate: new Date(Date.now() - 6 * 3600000) } });
    expect(house(await poll())).toMatchObject({ canUnmark: false, blockedReason: 'unmark_window_expired' });
    await request(app.getHttpServer()).patch(ctx.patchPath).set('Authorization', `Bearer ${ctx.publisherAccess.token}`).send({ status: false, round: 1 }).expect(403);
    await request(app.getHttpServer()).patch(ctx.patchPath).set('Authorization', `Bearer ${ctx.publisherAccess.token}`).send({ status: true, round: 1 }).expect(200);
    expect(house(await poll())).toMatchObject({ canUnmark: false, blockedReason: 'unmark_window_expired' });
  });

  it('atualiza as permissões quando muda a configuração de prazo, mesmo sem revisão de casa', async () => {
    await ctx.prisma.round.updateMany({ where: { houseId: ctx.house.id }, data: { completed: true, completedDate: new Date(Date.now() - 2 * 3600000) } });
    const initial = await poll().expect(200);
    expect(house(initial).canUnmark).toBe(true);
    await ctx.prisma.parameter.create({ data: { tenantId: ctx.tenant.id, key: 'SIGNATURE_EXPIRATION_HOURS', value: '0' } });
    const changed = await poll(initial.body.cursor).expect(200);
    expect(changed.body.changed).toBe(true);
    expect(house(changed)).toMatchObject({ canUnmark: false, blockedReason: 'unmark_window_expired' });
  });
});
