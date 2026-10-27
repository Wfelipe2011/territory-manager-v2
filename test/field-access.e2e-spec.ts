import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { fieldFixture } from './utils/field-fixture';

describe('Acessos da área de campo', () => {
  let app: INestApplication;
  let ctx: Awaited<ReturnType<typeof fieldFixture>>;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await cleanDatabase(app.get(PrismaService)); ctx = await fieldFixture(app); });

  it('gera seis caracteres e mantém UUIDs existentes sem cache de acesso revogado', async () => {
    expect(ctx.leader.signature).toMatch(/^[A-Z0-9]{6}$/);
    expect(ctx.publisher.signature).toMatch(/^[A-Z0-9]{6}$/);
    const lower = await request(app.getHttpServer()).get(`/v1/signature/${ctx.publisher.signature.toLowerCase()}`).expect(200);
    expect(lower.body.access).toMatchObject({ role: 'publisher', blockId: ctx.block.id, round: 1 });
    expect(lower.headers['cache-control']).toBe('no-store');
    const key = randomUUID();
    const token = createTestToken({ id: key, tenantId: ctx.tenant.id, territoryId: ctx.territory.id, blockId: ctx.block.id, round: 1, roles: ['publisher'] });
    await ctx.prisma.signature.create({ data: { key, token, tenantId: ctx.tenant.id, expirationDate: new Date(Date.now() + 60000) } });
    await request(app.getHttpServer()).get(`/v1/signature/${key}`).expect(200);
    await ctx.prisma.signature.delete({ where: { key } });
    await request(app.getHttpServer()).get(`/v1/signature/${key}`).expect(404);
  });

  it('refaz códigos em colisão e impede duas designações concorrentes', async () => {
    const second = await ctx.prisma.territory.create({ data: { name: 'Outro território', tenantId: ctx.tenant.id, typeId: ctx.type.id } });
    const generate = jest.spyOn(ctx.signatures as any, 'code').mockReturnValueOnce(ctx.leader.signature).mockReturnValueOnce('ABC123');
    const value = await ctx.signatures.generateTerritory({ tenantId: ctx.tenant.id, territoryId: second.id, round: 1, expirationTime: '2099-12-31', overseer: 'QA' });
    expect(value.signature).toBe('ABC123'); generate.mockRestore();
    const third = await ctx.prisma.territory.create({ data: { name: 'Concorrência', tenantId: ctx.tenant.id, typeId: ctx.type.id } });
    const results = await Promise.allSettled([1, 2].map(() => ctx.signatures.generateTerritory({ tenantId: ctx.tenant.id, territoryId: third.id, round: 1, expirationTime: '2099-12-31', overseer: 'QA' })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await ctx.prisma.territory_overseer.count({ where: { territoryId: third.id, signatureId: { not: null } } })).toBe(1);
  });

  it('bloqueia outro tenant, território, quadra, rua, rodada e funções administrativas', async () => {
    const http = app.getHttpServer();
    const token = ctx.publisherAccess.token;
    const other = await fieldFixture(app);
    await request(http).patch(other.patchPath).set('Authorization', `Bearer ${token}`).send({ status: true, round: 1 }).expect(403);
    await request(http).get('/v1/field/sync').query({ ...ctx.query, blockId: other.block.id }).set('Authorization', `Bearer ${token}`).expect(403);
    await request(http).get('/v1/field/sync').query({ ...ctx.query, addressId: other.address.id }).set('Authorization', `Bearer ${token}`).expect(403);
    await request(http).patch(ctx.patchPath).set('Authorization', `Bearer ${token}`).send({ status: true, round: 2 }).expect(403);
    await request(http).get('/v1/auth/admin/users').set('Authorization', `Bearer ${token}`).expect(403);
    await request(http).post(`/v1/territories/${ctx.territory.id}/blocks/${ctx.block.id}/signature/1`).set('Authorization', `Bearer ${token}`).expect(403);
    await request(http).post(`/v1/territories/${other.territory.id}/blocks/${other.block.id}/signature/1`).set('Authorization', `Bearer ${ctx.leaderAccess.token}`).expect(403);
  });

  it('recusa links expirados e devolve erro controlado após dez colisões', async () => {
    await ctx.prisma.signature.update({ where: { key: ctx.publisher.signature }, data: { expirationDate: new Date(0) } });
    await request(app.getHttpServer()).get(`/v1/signature/${ctx.publisher.signature}`).expect(404);
    await request(app.getHttpServer()).get('/v1/field/sync').query(ctx.query).set('Authorization', `Bearer ${ctx.publisherAccess.token}`).expect(403);
    const second = await ctx.prisma.territory.create({ data: { name: 'Colisões', tenantId: ctx.tenant.id, typeId: ctx.type.id } });
    const generate = jest.spyOn(ctx.signatures as any, 'code').mockReturnValue(ctx.leader.signature);
    await expect(ctx.signatures.generateTerritory({ tenantId: ctx.tenant.id, territoryId: second.id, round: 1, expirationTime: '2099-12-31', overseer: 'QA' })).rejects.toMatchObject({ status: 503 });
    generate.mockRestore();
  });

  it('não deixa um link de publicador sobreviver à revogação concorrente do dirigente', async () => {
    await ctx.signatures.deleteBlockSignature(ctx.territory.id, ctx.block.id, ctx.tenant.id, 1);
    await Promise.allSettled([
      ctx.signatures.generateTerritoryBlock({ tenantId: ctx.tenant.id, territoryId: ctx.territory.id, blockId: ctx.block.id, round: 1, parentSignature: ctx.leader.signature }),
      ctx.signatures.deleteTerritorySignature(ctx.territory.id, ctx.tenant.id, 1),
    ]);
    const block = await ctx.prisma.territory_block.findUniqueOrThrow({ where: { territoryId_blockId: { territoryId: ctx.territory.id, blockId: ctx.block.id } } });
    expect(block.signatureId).toBeNull();
    expect(await ctx.prisma.block_signature.count({ where: { territoryBlockId: block.id } })).toBe(0);
    await expect(ctx.signatures.generateTerritoryBlock({ tenantId: ctx.tenant.id, territoryId: ctx.territory.id, blockId: ctx.block.id, round: 1, parentSignature: ctx.leader.signature })).rejects.toMatchObject({ status: 403 });
  });
});
