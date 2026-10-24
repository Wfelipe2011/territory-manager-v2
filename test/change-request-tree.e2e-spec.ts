import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { requestFixture } from './utils/request-fixture';

describe('Solicitações vinculadas e catálogo sem rodada', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await cleanDatabase(app.get(PrismaService));
  });

  it('cadastra a árvore vazia, compartilha quadra provisória e aprova sem trocar IDs', async () => {
    const f = await requestFixture(app),
      tree = await f.tree();
    const link = await request(f.server)
      .post(`/v1/territories/${f.territory.id}/blocks/${tree.block.targetId}/signature`)
      .set(f.auth(f.leader))
      .send({})
      .expect(201);
    expect(link.body.signature).toMatch(/^[A-Z0-9]{6}$/);
    const publisher = (await request(f.server).get(`/v1/signature/${link.body.signature}`).expect(200)).body;
    expect(publisher.access.round).toBeNull();
    const before = await f.snapshot(tree.block.targetId, publisher.token);
    expect(before.data.streets[0].houses[0]).toMatchObject({ id: tree.house.targetId, canMark: true, blockedReason: null, hasRound: true });
    await f.review([tree.house, tree.block, tree.street]).expect(201);
    const after = await f.snapshot(tree.block.targetId, publisher.token);
    expect(after.cursor).not.toBe(before.cursor);
    expect(after.data.streets[0].houses[0]).toMatchObject({ id: tree.house.targetId, canMark: true, blockedReason: null });
    expect(await f.prisma.round.count()).toBe(1);
    expect(await f.prisma.house.count()).toBe(1);
  });
  it('exige pais aprovados e aplica lote atomicamente, evitando aprovação duplicada', async () => {
    const f = await requestFixture(app),
      tree = await f.tree();
    await f.review([tree.house]).expect(409);
    await f.review([tree.house, tree.street]).expect(409);
    expect(await f.prisma.change_request.count({ where: { status: 'approved' } })).toBe(0);
    const results = await Promise.all([f.review([tree.block, tree.street, tree.house]), f.review([tree.house, tree.street, tree.block])]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
  });
  it('rejeita descendentes e invalida acesso à quadra rejeitada sem duplicar a revisão', async () => {
    const f = await requestFixture(app),
      tree = await f.tree();
    const link = await request(f.server)
      .post(`/v1/territories/${f.territory.id}/blocks/${tree.block.targetId}/signature`)
      .set(f.auth(f.leader))
      .send({})
      .expect(201);
    const token = (await request(f.server).get(`/v1/signature/${link.body.signature}`)).body.token;
    const detail = (await request(f.server).get(`/v1/change-requests/${tree.block.id}`).set(f.auth(f.admin))).body;
    await f.review([detail, tree.house, tree.street], 'reject', { confirmDeletion: true }).expect(201);
    const rows = await f.prisma.change_request.findMany();
    expect(rows.every(r => r.status === 'rejected' && r.version === 2)).toBe(true);
    expect(await f.prisma.house.findUnique({ where: { id: tree.house.targetId } })).toBeNull();
    expect(await f.prisma.round.count()).toBe(0);
    await request(f.server)
      .get(`/v1/field/blocks/${tree.block.targetId}/sync`)
      .set(f.auth(token))
      .query({ clientId: 'aaaaaaaaaaaaaaaa', tabId: 'bbbbbbbbbbbbbbbb' })
      .expect(403);
  });
  it('aplica a permissão do link ao vivo e mantém relatos de casas para publicadores', async () => {
    const f = await requestFixture(app),
      tree = await f.tree();
    await f.review(Object.values(tree)).expect(201);
    await request(f.server).patch(`/v1/signature/${f.code}/permissions`).set(f.auth(f.admin)).send({ canEditStructure: false }).expect(200);
    expect((await f.snapshot(tree.block.targetId)).data.capabilities.canEditStructure).toBe(false);
    await request(f.server)
      .post('/v1/change-requests')
      .set(f.auth(f.leader))
      .send({ entity: 'block', action: 'create', territoryId: f.territory.id, data: { name: 'Proibida' }, observations: 'Teste' })
      .expect(403);
    const link = await request(f.server)
      .post(`/v1/territories/${f.territory.id}/blocks/${tree.block.targetId}/signature`)
      .set(f.auth(f.leader))
      .send({})
      .expect(201);
    const publisher = (await request(f.server).get(`/v1/signature/${link.body.signature}`)).body.token;
    await f.create('house', { number: '12' }, { blockId: tree.block.targetId, addressId: tree.street.addressId }, 'create', publisher);
    await request(f.server).patch(`/v1/signature/${f.code}/permissions`).set(f.auth(f.leader)).send({ canEditStructure: true }).expect(403);
    await request(f.server).patch(`/v1/signature/${f.code}/permissions`).set(f.auth(f.admin)).send({ canEditStructure: true }).expect(200);
    await f.create('street', { name: 'Outra rua' }, { blockId: tree.block.targetId });
  });
  it('rejeita duplicados e impede acesso a outra quadra ou congregação', async () => {
    const f = await requestFixture(app),
      tree = await f.tree();
    await request(f.server)
      .post('/v1/change-requests')
      .set(f.auth(f.leader))
      .send({ entity: 'block', action: 'create', territoryId: f.territory.id, data: { name: 'quadra nova' }, observations: 'Duplicada' })
      .expect(409);
    const other = await requestFixture(app);
    await request(f.server).get(`/v1/change-requests/${tree.house.id}`).set(other.auth(other.admin)).expect(404);
    await request(f.server)
      .post('/v1/change-requests')
      .set(other.auth(other.leader))
      .send({
        entity: 'house',
        action: 'create',
        territoryId: f.territory.id,
        blockId: tree.block.targetId,
        addressId: tree.street.addressId,
        data: { number: '99' },
        observations: 'Outro tenant',
      })
      .expect(403);
  });
});
