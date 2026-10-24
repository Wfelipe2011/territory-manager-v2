import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { requestFixture } from './utils/request-fixture';

describe('Trabalho em casas provisórias', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await cleanDatabase(app.get(PrismaService)); });
  it('marca sob pais provisórios e preserva a data ao aprovar toda a árvore', async () => {
    const f = await requestFixture(app), tree = await f.tree();
    const route = `/v1/territories/${f.territory.id}/blocks/${tree.block.targetId}/address/${tree.street.addressId}/houses/${tree.house.targetId}`;
    await request(f.server).patch(route).set(f.auth(f.leader)).send({ round: 1, status: true }).expect(200);
    const before = await f.prisma.round.findFirstOrThrow({ where: { houseId: tree.house.targetId } });
    await f.review(Object.values(tree)).expect(201);
    expect(await f.prisma.round.findFirstOrThrow({ where: { houseId: tree.house.targetId } })).toMatchObject({ id: before.id, completed: true, completedDate: before.completedDate });
    expect(await f.prisma.round.count()).toBe(1);
  });
  it('inicia uma única rodada padrão concorrente e inclui outras casas do mesmo tipo', async () => {
    const f = await requestFixture(app), tree = await f.tree();
    await f.prisma.round_info.updateMany({ data: { status: 'closed', theme: 'campaign' } });
    await f.prisma.round.updateMany({ data: { endDate: new Date() } });
    const territory = await f.prisma.territory.create({ data: { tenantId: f.tenant.id, typeId: f.type.id, name: 'Outro território' } });
    const legacy = await f.prisma.house.create({ data: { tenantId: f.tenant.id, territoryId: territory.id, blockId: tree.block.targetId, addressId: tree.street.addressId, number: '90' } });
    await Promise.all([f.create('house', { number: '12' }, { blockId: tree.block.targetId, addressId: tree.street.addressId }), f.create('house', { number: '14' }, { blockId: tree.block.targetId, addressId: tree.street.addressId })]);
    expect(await f.prisma.round_info.count({ where: { status: 'open' } })).toBe(1);
    expect(await f.prisma.round_info.findFirstOrThrow({ where: { status: 'open' } })).toMatchObject({ roundNumber: 2, theme: 'default', colorPrimary: '#7AAD58' });
    expect(await f.prisma.round.count({ where: { roundNumber: 2 } })).toBe(4);
    expect(await f.prisma.round.count({ where: { houseId: legacy.id, roundNumber: 2 } })).toBe(1);
    const other = await requestFixture(app);
    expect(await other.prisma.round.count({ where: { tenantId: other.tenant.id } })).toBe(0);
  });
  it('reconfirma impacto após marcação e exclui a árvore mantendo o histórico das solicitações', async () => {
    const f = await requestFixture(app), tree = await f.tree();
    const detail = async () => (await request(f.server).get(`/v1/change-requests/${tree.block.id}`).set(f.auth(f.admin)).expect(200)).body;
    const stale = await detail();
    await f.review([stale], 'reject').expect(409);
    await request(f.server).patch(`/v1/territories/${f.territory.id}/blocks/${tree.block.targetId}/address/${tree.street.addressId}/houses/${tree.house.targetId}`).set(f.auth(f.leader)).send({ round: 1, status: true }).expect(200);
    await f.review([stale], 'reject', { confirmDeletion: true }).expect(409);
    const fresh = await detail();
    expect(fresh.impact).toMatchObject({ houses: 1, rounds: 1 });
    await f.review([fresh], 'reject', { confirmDeletion: true }).expect(201);
    expect(await f.prisma.house.count()).toBe(0);
    expect(await f.prisma.round.count()).toBe(0);
    expect(await f.prisma.territory_block.count()).toBe(0);
    expect(await f.prisma.change_request.count({ where: { status: 'rejected' } })).toBe(3);
    expect(await f.prisma.round_info.count()).toBe(1);
  });
  it('rejeita uma correção sem apagar a casa aprovada nem sua marcação', async () => {
    const f = await requestFixture(app), tree = await f.tree();
    await f.review(Object.values(tree)).expect(201);
    await f.prisma.round.updateMany({ data: { completed: true, completedDate: new Date() } });
    const edit = await f.create('house', { number: '22' }, { blockId: tree.block.targetId, addressId: tree.street.addressId, targetId: tree.house.targetId }, 'update');
    await f.review([edit], 'reject').expect(201);
    expect(await f.prisma.house.findUniqueOrThrow({ where: { id: tree.house.targetId } })).toMatchObject({ number: '10', registrationStatus: 'approved' });
    expect((await f.prisma.round.findFirstOrThrow()).completed).toBe(true);
  });
});
