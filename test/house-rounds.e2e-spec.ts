import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';
import dayjs from 'dayjs';

/**
 * REGRA: ao criar uma casa real (POST /v1/houses), devem ser criadas linhas
 * em `round` SOMENTE para as rodadas ABERTAS (end_date IS NULL), com
 * completed=false, mode='default', start_date≈now, leave_letter=false.
 * Sem rodada aberta -> NENHUMA linha (a casa entra na próxima rodada via
 * abertura). Rodadas fechadas NUNCA recebem linha nova (evita o "lixo":
 * linhas com end_date NULL dentro de rodadas fechadas que fabricam
 * histórico e corrompem leave_letter/contadores).
 */
describe('House create -> rounds (regra: somente rodadas abertas) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  async function criarEstrutura(nomeTenant: string) {
    const tenant = await prisma.multitenancy.create({ data: { name: nomeTenant } });
    const type = await prisma.type.create({ data: { name: 'Tipo', tenantId: tenant.id } });
    const territory = await prisma.territory.create({ data: { name: 'Território', tenantId: tenant.id, typeId: type.id } });
    const block = await prisma.block.create({ data: { name: 'Quadra', tenantId: tenant.id } });
    const address = await prisma.address.create({ data: { name: 'Rua', tenantId: tenant.id } });
    const tb = await prisma.territory_block.create({ data: { blockId: block.id, territoryId: territory.id, tenantId: tenant.id } });
    const tba = await prisma.territory_block_address.create({ data: { territoryBlockId: tb.id, addressId: address.id, tenantId: tenant.id } });
    const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });
    return { tenant, type, territory, block, address, tba, token };
  }

  async function criarRodada(
    tenantId: number,
    roundNumber: number,
    endDate: Date | null,
    ctx: { territoryId: number; blockId: number; addressId: number; tbaId: number }
  ) {
    const dummy = await prisma.house.create({
      data: {
        number: '0-dummy',
        blockId: ctx.blockId,
        addressId: ctx.addressId,
        territoryId: ctx.territoryId,
        tenantId,
        territoryBlockAddressId: ctx.tbaId,
      },
    });
    await prisma.round_info.create({
      data: { roundNumber, name: `Rodada ${roundNumber}`, tenantId, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' },
    });
    await prisma.round.create({
      data: {
        roundNumber,
        tenantId,
        territoryId: ctx.territoryId,
        blockId: ctx.blockId,
        houseId: dummy.id,
        completed: false,
        startDate: dayjs().subtract(3, 'months').toDate(),
        endDate,
      },
    });
  }

  async function criarCasaViaApi(token: string, blockId: number, addressId: number, territoryId: number, number: string) {
    const res = await request(app.getHttpServer())
      .post('/v1/houses')
      .set('Authorization', `Bearer ${token}`)
      .send({ number, blockId, streetId: addressId, territoryId, dontVisit: false, legend: '' });
    return res;
  }

  async function abrirRodada(token: string, typeId: number) {
    return request(app.getHttpServer())
      .post('/v1/rounds/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nova Rodada', typeId, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' });
  }

  it('casa criada sem nenhuma rodada existente: NENHUMA linha de round é criada; entra na próxima rodada', async () => {
    const { tenant, type, territory, block, address, tba, token } = await criarEstrutura('Sem Rodadas');

    const res = await criarCasaViaApi(token, block.id, address.id, territory.id, '10');
    expect(res.status).toBe(201);

    const rounds = await prisma.round.findMany({ where: { houseId: res.body.id } });
    expect(rounds.length).toBe(0);

    // Ao abrir a rodada 1, a casa entra (linha criada pela abertura)
    const openRes = await abrirRodada(token, type.id);
    expect(openRes.status).toBe(201);

    const round1 = await prisma.round.findFirst({ where: { houseId: res.body.id, roundNumber: 1 } });
    expect(round1).not.toBeNull();
    expect(round1?.completed).toBe(false);
  });

  it('casa criada com rodada aberta e rodada fechada: cria linha SOMENTE para a rodada aberta, com campos corretos', async () => {
    const { tenant, type, territory, block, address, tba, token } = await criarEstrutura('Aberta e Fechada');

    await criarRodada(tenant.id, 1, dayjs().subtract(2, 'months').toDate(), {
      territoryId: territory.id,
      blockId: block.id,
      addressId: address.id,
      tbaId: tba.id,
    }); // fechada
    await criarRodada(tenant.id, 2, null, { territoryId: territory.id, blockId: block.id, addressId: address.id, tbaId: tba.id }); // aberta

    const antes = Date.now();
    const res = await criarCasaViaApi(token, block.id, address.id, territory.id, '20');
    expect(res.status).toBe(201);

    const rounds = await prisma.round.findMany({ where: { houseId: res.body.id } });
    expect(rounds.length).toBe(1);

    const [round] = rounds;
    expect(round.roundNumber).toBe(2);
    expect(round.completed).toBe(false);
    expect(round.mode).toBe('default');
    expect(round.leaveLetter).toBe(false);
    expect(round.endDate).toBeNull();
    expect(round.startDate.getTime()).toBeGreaterThanOrEqual(antes);
    expect(round.startDate.getTime()).toBeLessThanOrEqual(Date.now());

    // A rodada fechada NÃO pode receber linha nova (lixo)
    const roundFechada = await prisma.round.findFirst({ where: { houseId: res.body.id, roundNumber: 1 } });
    expect(roundFechada).toBeNull();
  });

  it('casa criada com APENAS rodada fechada: NENHUMA linha de round é criada (nem com end_date NULL)', async () => {
    const { tenant, type, territory, block, address, tba, token } = await criarEstrutura('So Fechada');

    await criarRodada(tenant.id, 1, dayjs().subtract(2, 'months').toDate(), {
      territoryId: territory.id,
      blockId: block.id,
      addressId: address.id,
      tbaId: tba.id,
    });

    const res = await criarCasaViaApi(token, block.id, address.id, territory.id, '30');
    expect(res.status).toBe(201);

    const rounds = await prisma.round.findMany({ where: { houseId: res.body.id } });
    expect(rounds.length).toBe(0);

    // Garantir que não existe nenhuma linha órfã da rodada fechada com end_date NULL
    const lixo = await prisma.round.findFirst({
      where: { tenantId: tenant.id, roundNumber: 1, endDate: null },
    });
    expect(lixo?.houseId ?? null).not.toBe(res.body.id);

    // Ao abrir a rodada 2, a casa entra SEM carta (sem histórico fabricado)
    const openRes = await abrirRodada(token, type.id);
    expect(openRes.status).toBe(201);

    const round2 = await prisma.round.findFirst({ where: { houseId: res.body.id, roundNumber: 2 } });
    expect(round2).not.toBeNull();
    expect(round2?.leaveLetter).toBe(false);
  });

  it('casa criada durante rodada aberta: entra na próxima rodada com carta (nunca visitada)', async () => {
    const { tenant, type, territory, block, address, tba, token } = await criarEstrutura('Mid Round');

    await criarRodada(tenant.id, 1, null, { territoryId: territory.id, blockId: block.id, addressId: address.id, tbaId: tba.id }); // aberta

    const res = await criarCasaViaApi(token, block.id, address.id, territory.id, '40');
    expect(res.status).toBe(201);

    // Fecha a rodada 1 e abre a rodada 2
    const finishRes = await request(app.getHttpServer()).post('/v1/rounds/finish').set('Authorization', `Bearer ${token}`).send({ roundNumber: 1 });
    expect(finishRes.status).toBe(201);

    const openRes = await abrirRodada(token, type.id);
    expect(openRes.status).toBe(201);

    const round2 = await prisma.round.findFirst({ where: { houseId: res.body.id, roundNumber: 2 } });
    expect(round2).not.toBeNull();
    // Nunca visitada + histórico (rodada 1) -> carta
    expect(round2?.leaveLetter).toBe(true);
  });
});
