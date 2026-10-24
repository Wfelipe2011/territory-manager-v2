import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { fieldFixture } from './utils/field-fixture';

describe('Metadados e restrições da área de campo', () => {
  let app: INestApplication;
  let ctx: Awaited<ReturnType<typeof fieldFixture>>;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await cleanDatabase(app.get(PrismaService)); ctx = await fieldFixture(app); });

  it('sincroniza quadras vazias e configurações da congregação', async () => {
    await ctx.prisma.round.deleteMany({ where: { houseId: ctx.house.id } });
    await ctx.prisma.house.delete({ where: { id: ctx.house.id } });
    const poll = (cursor?: string) => request(app.getHttpServer()).get('/v1/field/sync')
      .set('Authorization', `Bearer ${ctx.leaderAccess.token}`)
      .query({ ...ctx.identity, scope: 'territory', ...(cursor ? { cursor } : {}) });
    const before = await poll().expect(200);
    await ctx.prisma.block.update({ where: { id: ctx.block.id }, data: { name: 'Quadra vazia atualizada' } });
    await ctx.prisma.multitenancy.update({ where: { id: ctx.tenant.id }, data: { city: 'Outra cidade' } });
    const after = await poll(before.body.cursor).expect(200);
    expect(after.body.data.blocks[0]).toMatchObject({ name: 'Quadra vazia atualizada', total: 0 });
    expect(after.body.data.tenancy.city).toBe('Outra cidade');
  });

  it('impede marcação de não bater e rodadas encerradas, mantendo correções pendentes', async () => {
    const mark = () => request(app.getHttpServer()).patch(ctx.patchPath)
      .set('Authorization', `Bearer ${ctx.publisherAccess.token}`).send({ status: true, round: 1 });
    await ctx.prisma.house.update({ where: { id: ctx.house.id }, data: { dontVisit: true } });
    await mark().expect(403);
    await ctx.prisma.house.update({ where: { id: ctx.house.id }, data: { dontVisit: false, reportType: 'update' } });
    await mark().expect(200);
    await ctx.prisma.house.update({ where: { id: ctx.house.id }, data: { reportType: null } });
    await ctx.prisma.round.updateMany({ where: { houseId: ctx.house.id }, data: { endDate: new Date() } });
    await mark().expect(403);
    expect((await ctx.prisma.round.findFirstOrThrow({ where: { houseId: ctx.house.id } })).completed).toBe(true);
  });

  it('preserva sessões históricas e adiciona sessões HTTP à mesma consulta de histórico', async () => {
    await ctx.prisma.socket.create({ data: { socketId: 'historico-qa', room: 'legado', tenantId: ctx.tenant.id, createdAt: new Date(Date.now() - 120000), disconnectedAt: new Date(Date.now() - 60000) } });
    await request(app.getHttpServer()).get('/v1/field/sync').set('Authorization', `Bearer ${ctx.publisherAccess.token}`).query(ctx.query).expect(200);
    const rows = await ctx.prisma.$queryRaw<{ room: string }[]>`SELECT room FROM field_session_history WHERE tenant_id = ${ctx.tenant.id}`;
    expect(rows).toHaveLength(2);
    expect(rows.some(row => row.room === 'legado')).toBe(true);
  });

  it('sincroniza uma rua recém-vinculada antes de cadastrar casas', async () => {
    const poll = (cursor?: string) => request(app.getHttpServer()).get('/v1/field/sync')
      .set('Authorization', `Bearer ${ctx.publisherAccess.token}`)
      .query({ ...ctx.identity, scope: 'block', blockId: ctx.block.id, ...(cursor ? { cursor } : {}) });
    const before = await poll().expect(200);
    const address = await ctx.prisma.address.create({ data: { name: 'Rua vazia', tenantId: ctx.tenant.id } });
    const block = await ctx.prisma.territory_block.findFirstOrThrow({ where: { tenantId: ctx.tenant.id, territoryId: ctx.territory.id, blockId: ctx.block.id } });
    await ctx.prisma.territory_block_address.create({ data: { tenantId: ctx.tenant.id, territoryBlockId: block.id, addressId: address.id } });
    const after = await poll(before.body.cursor).expect(200);
    expect(after.body.data.streets).toContainEqual(expect.objectContaining({ id: address.id, name: 'Rua vazia', pending: 0, numbers: [] }));
  });
});
