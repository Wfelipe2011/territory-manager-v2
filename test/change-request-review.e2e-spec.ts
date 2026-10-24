import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { requestFixture } from './utils/request-fixture';

describe('Revisão e participação na rodada', () => {
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
  it('inicia rodada vazia e insere casa aprovada na última aberta compatível sem reiniciar trabalho', async () => {
    const f = await requestFixture(app);
    await request(f.server)
      .post('/v1/rounds/start')
      .set(f.auth(f.admin))
      .send({ name: 'Vazia', typeId: f.type.id, theme: 'default', colorPrimary: '#123456', colorSecondary: '#ffffff' })
      .expect(201);
    expect(await f.prisma.round.count()).toBe(0);
    const otherType = await f.prisma.type.create({ data: { tenantId: f.tenant.id, name: 'Comercial' } });
    await f.prisma.round_info.createMany({
      data: [
        { tenantId: f.tenant.id, roundNumber: 2, name: 'Outra', theme: 'default', typeIds: [otherType.id], status: 'open' },
        { tenantId: f.tenant.id, roundNumber: 3, name: 'Fechada', theme: 'default', typeIds: [f.type.id], status: 'closed' },
      ],
    });
    const tree = await f.tree();
    await f.review(Object.values(tree)).expect(201);
    const round = await f.prisma.round.findFirstOrThrow({ where: { houseId: tree.house.targetId } });
    expect(round.roundNumber).toBe(1);
    await f.prisma.round.update({ where: { id: round.id }, data: { completed: true, completedDate: new Date() } });
    const edit = await f.create(
      'house',
      { number: '11' },
      { blockId: tree.block.targetId, addressId: tree.street.addressId, targetId: tree.house.targetId },
      'update'
    );
    await f.review([edit]).expect(201);
    expect((await f.prisma.round.findUniqueOrThrow({ where: { id: round.id } })).completed).toBe(true);
    expect(await f.prisma.round.count({ where: { houseId: tree.house.targetId } })).toBe(1);
    await request(f.server).post('/v1/rounds/finish').set(f.auth(f.admin)).send({ roundNumber: 1 }).expect(201);
    const another = await f.create('house', { number: '13' }, { blockId: tree.block.targetId, addressId: tree.street.addressId });
    await f.review([another]).expect(201);
    expect(await f.prisma.round.count({ where: { houseId: another.targetId } })).toBe(1);
    expect((await f.snapshot(tree.block.targetId)).data.workRoundNumber).toBe(4);
  });
  it('mantém cadastro e marcação durante a análise, preservando campos omitidos e detectando conflito', async () => {
    const f = await requestFixture(app),
      tree = await f.tree();
    await f.review(Object.values(tree)).expect(201);
    await f.prisma.round.deleteMany({});
    await f.prisma.round.create({
      data: {
        tenantId: f.tenant.id,
        territoryId: f.territory.id,
        blockId: tree.block.targetId,
        houseId: tree.house.targetId,
        roundNumber: 1,
        completed: false,
      },
    });
    await f.prisma.house.update({ where: { id: tree.house.targetId }, data: { phone: '11999990000' } });
    const edit = await f.create(
      'house',
      { number: '20' },
      { blockId: tree.block.targetId, addressId: tree.street.addressId, targetId: tree.house.targetId },
      'update'
    );
    const before = (await f.snapshot(tree.block.targetId)).data.streets[0].houses[0];
    expect(before).toMatchObject({ number: '10', canMark: true, pendingRequest: { id: edit.id } });
    await request(f.server)
      .patch(`/v1/territories/${f.territory.id}/blocks/${tree.block.targetId}/address/${tree.street.addressId}/houses/${tree.house.targetId}`)
      .set(f.auth(f.leader))
      .send({ round: 1, status: true })
      .expect(200);
    await f.review([edit]).expect(201);
    expect(await f.prisma.house.findUniqueOrThrow({ where: { id: tree.house.targetId } })).toMatchObject({ number: '20', phone: '11999990000' });
    const next = await f.create(
      'house',
      { number: '30' },
      { blockId: tree.block.targetId, addressId: tree.street.addressId, targetId: tree.house.targetId },
      'update'
    );
    let ready!: () => void, release!: () => void;
    const locked = new Promise<void>(resolve => {
      ready = resolve;
    });
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const editing = f.prisma.$transaction(async tx => {
      await tx.house.update({ where: { id: tree.house.targetId }, data: { number: '22' } });
      ready();
      await gate;
    });
    await locked;
    const reviewing = f.review([next]).then(response => response);
    await new Promise(resolve => setTimeout(resolve, 150));
    release();
    await editing;
    expect((await reviewing).status).toBe(409);
    expect((await f.prisma.house.findUniqueOrThrow({ where: { id: tree.house.targetId } })).number).toBe('22');
  });
  it('corrige rua somente no vínculo solicitado, sem alterar endereço compartilhado', async () => {
    const f = await requestFixture(app),
      tree = await f.tree();
    await f.review(Object.values(tree)).expect(201);
    const territory = await f.prisma.territory.create({ data: { tenantId: f.tenant.id, name: 'Outro', typeId: f.type.id } });
    const tb = await f.prisma.territory_block.create({ data: { tenantId: f.tenant.id, territoryId: territory.id, blockId: tree.block.targetId } });
    const tba = await f.prisma.territory_block_address.create({ data: { tenantId: f.tenant.id, territoryBlockId: tb.id, addressId: tree.street.addressId } });
    const house = await f.prisma.house.create({
      data: {
        tenantId: f.tenant.id,
        territoryId: territory.id,
        blockId: tree.block.targetId,
        addressId: tree.street.addressId,
        territoryBlockAddressId: tba.id,
        number: '50',
      },
    });
    const edit = await f.create('street', { name: 'Rua corrigida' }, { blockId: tree.block.targetId, targetId: tree.street.targetId }, 'update');
    await f.review([edit]).expect(201);
    expect((await f.prisma.house.findUniqueOrThrow({ where: { id: tree.house.targetId } })).addressId).not.toBe(tree.street.addressId);
    expect((await f.prisma.house.findUniqueOrThrow({ where: { id: house.id } })).addressId).toBe(tree.street.addressId);
    expect((await f.prisma.address.findUniqueOrThrow({ where: { id: tree.street.addressId } })).name).toBe('Rua nova');
    const draft = await f.create('street', { name: 'Rua reenviada' }, { blockId: tree.block.targetId });
    const draftDetail = (await request(f.server).get(`/v1/change-requests/${draft.id}`).set(f.auth(f.admin))).body;
    await f.review([draftDetail], 'reject', { confirmDeletion: true }).expect(201);
    const resent = await f.create('street', { name: 'Rua reenviada' }, { blockId: tree.block.targetId });
    expect(resent.targetId).not.toBe(draft.targetId);
    await f.review([resent]).expect(201);
  });
  it('exige confirmação de impacto atualizado e exclui rua, casas e rodadas apenas na quadra', async () => {
    const f = await requestFixture(app),
      tree = await f.tree();
    await f.review(Object.values(tree)).expect(201);
    const other = await f.create('block', { name: 'Outra quadra' });
    await f.review([other]).expect(201);
    const street = await f.create('street', { name: 'Rua nova' }, { blockId: other.targetId });
    await f.review([street]).expect(201);
    const house = await f.create('house', { number: '50' }, { blockId: other.targetId, addressId: street.addressId });
    await f.review([house]).expect(201);
    const deletion = await f.create('street', {}, { blockId: tree.block.targetId, targetId: tree.street.targetId }, 'delete');
    const detail = (await request(f.server).get(`/v1/change-requests/${deletion.id}`).set(f.auth(f.admin))).body;
    await f.review([detail]).expect(409);
    const extra = await f.create('house', { number: '99' }, { blockId: tree.block.targetId, addressId: tree.street.addressId });
    await f.review([detail], 'approve', { confirmDeletion: true }).expect(409);
    const fresh = (await request(f.server).get(`/v1/change-requests/${deletion.id}`).set(f.auth(f.admin))).body;
    expect(fresh.impact.houses).toBe(2);
    await f.review([fresh], 'approve', { confirmDeletion: true }).expect(201);
    expect(await f.prisma.house.findUnique({ where: { id: tree.house.targetId } })).toBeNull();
    expect(await f.prisma.house.findUnique({ where: { id: house.targetId } })).not.toBeNull();
    expect((await f.prisma.change_request.findUniqueOrThrow({ where: { id: extra.id } })).status).toBe('rejected');
    expect(await f.prisma.address.findUnique({ where: { id: street.addressId } })).not.toBeNull();
  });
  it('revisa legado sem duplicar inclusão e restaura backup sem desfazer marcação', async () => {
    const f = await requestFixture(app),
      tree = await f.tree();
    await f.review(Object.values(tree)).expect(201);
    await f.prisma.round.deleteMany({});
    const round = await f.prisma.round.create({
      data: {
        tenantId: f.tenant.id,
        territoryId: f.territory.id,
        blockId: tree.block.targetId,
        houseId: tree.house.targetId,
        roundNumber: 1,
        completed: true,
        completedDate: new Date(),
      },
    });
    const live = await f.prisma.house.update({
      where: { id: tree.house.targetId },
      data: { number: '20', reportType: 'update', backupData: { number: '10', legend: 'Residência', dontVisit: false } },
    });
    const legacy = await f.prisma.change_request.create({
      data: {
        tenantId: f.tenant.id,
        territoryId: f.territory.id,
        blockId: tree.block.targetId,
        addressId: tree.street.addressId,
        targetId: live.id,
        entity: 'house',
        action: 'update',
        observations: 'Importado',
        proposedData: { number: '20', legend: 'Residência', dontVisit: false },
        beforeData: live.backupData!,
        isLegacy: true,
        legacyHouseId: live.id,
      },
    });
    await f.review([legacy], 'reject').expect(201);
    expect((await f.prisma.house.findUniqueOrThrow({ where: { id: live.id } })).number).toBe('10');
    expect((await f.prisma.round.findUniqueOrThrow({ where: { id: round.id } })).completed).toBe(true);
    const added = await f.prisma.house.create({
      data: {
        tenantId: f.tenant.id,
        territoryId: f.territory.id,
        blockId: tree.block.targetId,
        addressId: tree.street.addressId,
        number: '99',
        reportType: 'add',
      },
    });
    const inclusion = await f.prisma.change_request.create({
      data: {
        tenantId: f.tenant.id,
        territoryId: f.territory.id,
        blockId: tree.block.targetId,
        addressId: tree.street.addressId,
        targetId: added.id,
        entity: 'house',
        action: 'create',
        observations: 'Importado',
        proposedData: { number: '99' },
        isLegacy: true,
        legacyHouseId: added.id,
      },
    });
    await f.review([inclusion]).expect(201);
    expect(await f.prisma.house.count()).toBe(2);
    expect((await f.prisma.house.findUniqueOrThrow({ where: { id: added.id } })).reportType).toBeNull();
  });
});
