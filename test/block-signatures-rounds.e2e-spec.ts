import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { RoundService } from '../src/modules/round/round.service';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { fieldFixture } from './utils/field-fixture';
import { createTestToken } from './utils/auth-helper';

describe('Links de quadra separados por rodada', () => {
  let app: INestApplication;
  let ctx: Awaited<ReturnType<typeof fieldFixture>>;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await cleanDatabase(app.get(PrismaService)); ctx = await fieldFixture(app); });
  const poll = (token: string, cursor?: string) => request(app.getHttpServer()).get('/v1/field/sync')
    .set('Authorization', `Bearer ${token}`).query({ ...ctx.identity, scope: 'territory', ...(cursor ? { cursor } : {}) });
  const generate = (token: string, round?: number) => request(app.getHttpServer())
    .post(`/v1/territories/${ctx.territory.id}/blocks/${ctx.block.id}/signature${round == null ? '' : `/${round}`}`)
    .set('Authorization', `Bearer ${token}`).send({});
  async function secondRound() {
    await ctx.prisma.round_info.create({ data: { tenantId: ctx.tenant.id, roundNumber: 2, type: ctx.type.name, name: 'Rodada QA 2', theme: 'default' } });
    await ctx.prisma.round.create({ data: { tenantId: ctx.tenant.id, territoryId: ctx.territory.id, blockId: ctx.block.id, houseId: ctx.house.id, roundNumber: 2, completed: false } });
    const leader = await ctx.signatures.generateTerritory({ tenantId: ctx.tenant.id, territoryId: ctx.territory.id, round: 2, overseer: 'Dirigente QA 2', expirationTime: '2099-12-31' });
    return ctx.signatures.findTokenById(leader.signature);
  }

  it('preserva UUID legado e gera/reenvia um único link da nova rodada sob concorrência', async () => {
    await ctx.signatures.deleteBlockSignature(ctx.territory.id, ctx.block.id, ctx.tenant.id, 1);
    const key = randomUUID(), expirationDate = new Date(Date.now() + 365 * 86400000);
    const token = createTestToken({ id: key, tenantId: ctx.tenant.id, territoryId: ctx.territory.id, blockId: ctx.block.id, roles: ['publisher'], round: '1' });
    const legacy = await ctx.prisma.signature.create({ data: { key, token, expirationDate, tenantId: ctx.tenant.id } });
    await ctx.prisma.territory_block.update({ where: { territoryId_blockId: { territoryId: ctx.territory.id, blockId: ctx.block.id } }, data: { signatureId: legacy.id } });
    const two = await secondRound();
    expect((await poll(two.token).expect(200)).body.data.blocks[0].signature).toBeNull();
    const results = await Promise.all([generate(two.token, 2), generate(two.token, 2)]);
    expect(results.map(result => result.status)).toEqual([201, 201]);
    expect(results[0].body).toEqual(results[1].body);
    expect((await generate(two.token, 2).expect(201)).body).toEqual(results[0].body);
    expect(await ctx.prisma.block_signature.count({ where: { tenantId: ctx.tenant.id } })).toBe(2);
    expect((await ctx.signatures.findTokenById(key)).access.round).toBe(1);
    expect(await ctx.prisma.signature.findUnique({ where: { id: legacy.id } })).toMatchObject({ key, token, expirationDate });
    expect((await poll(ctx.leaderAccess.token).expect(200)).body.data.blocks[0].signature.key).toBe(key);
    expect((await poll(two.token).expect(200)).body.data.blocks[0].signature.key).toBe(results[0].body.signature);
    const oldView = await request(app.getHttpServer()).get(`/v1/territories/${ctx.territory.id}?round=1`).set('Authorization', `Bearer ${ctx.leaderAccess.token}`).expect(200);
    const newView = await request(app.getHttpServer()).get(`/v1/territories/${ctx.territory.id}?round=2`).set('Authorization', `Bearer ${two.token}`).expect(200);
    expect(oldView.body.blocks[0].signature.key).toBe(key);
    expect(newView.body.blocks[0].signature.key).toBe(results[0].body.signature);
  });

  it('isola cadastro sem rodada e limita a revogação ao escopo do dirigente', async () => {
    const catalog = await ctx.signatures.generateTerritory({ tenantId: ctx.tenant.id, territoryId: ctx.territory.id, overseer: 'Cadastro QA', expirationTime: '2099-12-31' });
    const access = await ctx.signatures.findTokenById(catalog.signature);
    const generated = await generate(access.token).expect(201);
    expect((await ctx.signatures.findTokenById(generated.body.signature)).access.round).toBeNull();
    expect((await poll(access.token).expect(200)).body.data.blocks[0].signature.key).toBe(generated.body.signature);
    const path = `/v1/territories/${ctx.territory.id}/blocks/${ctx.block.id}/signature`;
    await request(app.getHttpServer()).delete(path).set('Authorization', `Bearer ${access.token}`).expect(200);
    await request(app.getHttpServer()).get(`/v1/signature/${generated.body.signature}`).expect(404);
    expect((await ctx.signatures.findTokenById(ctx.publisher.signature)).access.round).toBe(1);
    await generate(access.token).expect(201);
    await request(app.getHttpServer()).delete(path + '/1').set('Authorization', `Bearer ${ctx.adminToken}`).expect(200);
    expect((await poll(access.token).expect(200)).body.data.blocks[0].signature).not.toBeNull();
    await request(app.getHttpServer()).delete(path).set('Authorization', `Bearer ${ctx.adminToken}`).expect(200);
    expect(await ctx.prisma.block_signature.count()).toBe(0);
    // A global administrative revoke must also remove grants attached to historical rows.
    await ctx.prisma.territory_overseer.updateMany({ where: { tenantId: ctx.tenant.id, roundNumber: null }, data: { finished: true } });
    await request(app.getHttpServer()).delete(`/v1/territories/${ctx.territory.id}/signature`).set('Authorization', `Bearer ${ctx.adminToken}`).expect(200);
    await request(app.getHttpServer()).get(`/v1/signature/${catalog.signature}`).expect(404);
    await request(app.getHttpServer()).get(`/v1/signature/${ctx.leader.signature}`).expect(404);
  });

  it('propaga expiração e revogação, e encerra somente os links da rodada escolhida', async () => {
    const two = await secondRound();
    const current = await generate(two.token, 2).expect(201);
    const before = await poll(two.token).expect(200);
    await ctx.prisma.signature.update({ where: { key: current.body.signature }, data: { expirationDate: new Date(0) } });
    const expired = await poll(two.token, before.body.cursor).expect(200);
    expect(expired.body.changed).toBe(true);
    expect(expired.body.data.blocks[0].signature).toBeNull();
    const replacement = await generate(two.token, 2).expect(201);
    expect(replacement.body.signature).not.toBe(current.body.signature);
    await request(app.getHttpServer()).delete(`/v1/territories/${ctx.territory.id}/signature/1`).set('Authorization', `Bearer ${ctx.adminToken}`).expect(200);
    await request(app.getHttpServer()).get(`/v1/signature/${ctx.publisher.signature}`).expect(404);
    expect((await ctx.signatures.findTokenById(replacement.body.signature)).access.round).toBe(2);
    // Closing must clean children even if the parent's grant was already removed.
    await ctx.prisma.signature.delete({ where: { key: two.access.code } });
    await app.get(RoundService).finish(ctx.tenant.id, 2);
    await request(app.getHttpServer()).get(`/v1/signature/${replacement.body.signature}`).expect(404);
    await generate(ctx.adminToken, 2).expect(400);
    expect(await ctx.prisma.round.count({ where: { houseId: ctx.house.id } })).toBe(2);
  });

  it('mantém isolamento de congregação, tipo e função nas associações e rotas', async () => {
    const other = await fieldFixture(app);
    await generate(other.leaderAccess.token, 1).expect(403);
    await generate(ctx.publisherAccess.token, 1).expect(403);
    await expect(ctx.prisma.block_signature.create({ data: { tenantId: other.tenant.id, territoryBlockId: (await ctx.prisma.territory_block.findFirstOrThrow({ where: { tenantId: ctx.tenant.id } })).id, roundNumber: 3, signatureId: (await ctx.prisma.signature.findUniqueOrThrow({ where: { key: other.publisher.signature } })).id } })).rejects.toThrow();
    await ctx.prisma.round_info.create({ data: { tenantId: ctx.tenant.id, roundNumber: 3, name: 'Comercial QA', type: 'Comercial', theme: 'default' } });
    await generate(ctx.adminToken, 3).expect(400);
    const remaining = await ctx.prisma.block_signature.findMany();
    expect(remaining).toHaveLength(2);
  });
});
