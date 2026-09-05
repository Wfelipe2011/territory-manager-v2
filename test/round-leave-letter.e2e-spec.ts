import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';
import dayjs from 'dayjs';

describe('Round leaveLetter (e2e)', () => {
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
    const house = await prisma.house.create({
      data: { number: '1', blockId: block.id, addressId: address.id, territoryId: territory.id, tenantId: tenant.id, territoryBlockAddressId: tba.id },
    });
    const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });
    return { tenant, type, territory, block, address, tba, house, token };
  }

  async function abrirRodada(token: string, typeId: number, theme: string) {
    return request(app.getHttpServer())
      .post('/v1/rounds/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nova Rodada', typeId, theme, colorPrimary: '#000', colorSecondary: '#fff' });
  }

  it('novo tenant sem histórico: leaveLetter deve ser false para todas as casas', async () => {
    const { tenant, type, token } = await criarEstrutura('Tenant Novo');

    const res = await abrirRodada(token, type.id, 'default');

    expect(res.status).toBe(201);

    const rounds = await prisma.round.findMany({ where: { tenantId: tenant.id } });
    expect(rounds.length).toBeGreaterThan(0);
    expect(rounds.every(r => r.leaveLetter === false)).toBe(true);
  });

  it('casa nunca visitada com histórico: leaveLetter deve ser true', async () => {
    const { tenant, type, territory, block, house, token } = await criarEstrutura('Tenant Nunca Visitado');

    // Criar rodada anterior (dentro da janela de 6 meses) com casa NÃO completada
    await prisma.round_info.create({
      data: { roundNumber: 1, name: 'Rodada Anterior', tenantId: tenant.id, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' },
    });
    await prisma.round.create({
      data: {
        roundNumber: 1,
        tenantId: tenant.id,
        territoryId: territory.id,
        blockId: block.id,
        houseId: house.id,
        completed: false,
        startDate: dayjs().subtract(2, 'months').toDate(),
        endDate: dayjs().subtract(1, 'months').toDate(),
      },
    });

    const res = await abrirRodada(token, type.id, 'default');

    expect(res.status).toBe(201);

    const novaRodada = await prisma.round.findFirst({ where: { tenantId: tenant.id, roundNumber: 2 } });
    expect(novaRodada?.leaveLetter).toBe(true);
  });

  it('casa visitada dentro da janela: leaveLetter deve ser false', async () => {
    const { tenant, type, territory, block, house, token } = await criarEstrutura('Tenant Visitado');

    // Criar rodada anterior (dentro da janela de 6 meses) com casa completada
    await prisma.round_info.create({
      data: { roundNumber: 1, name: 'Rodada Anterior', tenantId: tenant.id, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' },
    });
    await prisma.round.create({
      data: {
        roundNumber: 1,
        tenantId: tenant.id,
        territoryId: territory.id,
        blockId: block.id,
        houseId: house.id,
        completed: true,
        completedDate: dayjs().subtract(1, 'months').toDate(),
        startDate: dayjs().subtract(2, 'months').toDate(),
        endDate: dayjs().subtract(1, 'months').toDate(),
      },
    });

    const res = await abrirRodada(token, type.id, 'default');

    expect(res.status).toBe(201);

    const novaRodada = await prisma.round.findFirst({ where: { tenantId: tenant.id, roundNumber: 2 } });
    expect(novaRodada?.leaveLetter).toBe(false);
  });

  it('casa visitada FORA da janela configurada: leaveLetter deve ser true', async () => {
    const { tenant, type, territory, block, house, token } = await criarEstrutura('Tenant Visitado Fora Janela');

    // Janela de 1 mês; última visita há 2 meses (fora da janela)
    await prisma.parameter.create({
      data: { key: 'ROUND_START_DATE_MONTHS', value: '1', description: 'Teste', tenantId: tenant.id },
    });
    await prisma.round_info.create({
      data: { roundNumber: 1, name: 'Rodada Antiga', tenantId: tenant.id, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' },
    });
    await prisma.round.create({
      data: {
        roundNumber: 1,
        tenantId: tenant.id,
        territoryId: territory.id,
        blockId: block.id,
        houseId: house.id,
        completed: true,
        completedDate: dayjs().subtract(2, 'months').toDate(),
        startDate: dayjs().subtract(2, 'months').toDate(),
        endDate: dayjs().subtract(2, 'months').add(1, 'week').toDate(),
      },
    });

    const res = await abrirRodada(token, type.id, 'default');

    expect(res.status).toBe(201);

    const novaRodada = await prisma.round.findFirst({ where: { tenantId: tenant.id, roundNumber: 2 } });
    expect(novaRodada?.leaveLetter).toBe(true);
  });

  it('casa nunca visitada com histórico FORA da janela: leaveLetter deve ser true', async () => {
    const { tenant, type, territory, block, house, token } = await criarEstrutura('Tenant Fora Janela');

    // Janela de 1 mês; rodada anterior há 2 meses, casa nunca completada
    await prisma.parameter.create({
      data: { key: 'ROUND_START_DATE_MONTHS', value: '1', description: 'Teste', tenantId: tenant.id },
    });
    await prisma.round_info.create({
      data: { roundNumber: 1, name: 'Rodada Antiga', tenantId: tenant.id, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' },
    });
    await prisma.round.create({
      data: {
        roundNumber: 1,
        tenantId: tenant.id,
        territoryId: territory.id,
        blockId: block.id,
        houseId: house.id,
        completed: false,
        startDate: dayjs().subtract(2, 'months').toDate(),
        endDate: dayjs().subtract(2, 'months').add(1, 'week').toDate(),
      },
    });

    const res = await abrirRodada(token, type.id, 'default');

    expect(res.status).toBe(201);

    const novaRodada = await prisma.round.findFirst({ where: { tenantId: tenant.id, roundNumber: 2 } });
    // Tem histórico e nunca foi visitada → carta
    expect(novaRodada?.leaveLetter).toBe(true);
  });

  it('rodada campaign: leaveLetter deve ser false mesmo com histórico não visitado', async () => {
    const { tenant, type, territory, block, house, token } = await criarEstrutura('Tenant Campanha');

    // Rodada anterior com casa NÃO completada (histórico que geraria carta em rodada default)
    await prisma.round_info.create({
      data: { roundNumber: 1, name: 'Rodada Anterior', tenantId: tenant.id, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' },
    });
    await prisma.round.create({
      data: {
        roundNumber: 1,
        tenantId: tenant.id,
        territoryId: territory.id,
        blockId: block.id,
        houseId: house.id,
        completed: false,
        startDate: dayjs().subtract(2, 'months').toDate(),
        endDate: dayjs().subtract(1, 'months').toDate(),
      },
    });

    const res = await abrirRodada(token, type.id, 'campaign');

    expect(res.status).toBe(201);

    const novaRodada = await prisma.round.findFirst({ where: { tenantId: tenant.id, roundNumber: 2 } });
    expect(novaRodada?.leaveLetter).toBe(false);
  });

  it('visita em rodada campaign NÃO conta para a última visita: leaveLetter deve ser true', async () => {
    const { tenant, type, territory, block, house, token } = await criarEstrutura('Tenant Campanha Nao Conta');

    // Rodada default anterior com casa NÃO visitada (histórico pendente)
    await prisma.round_info.create({
      data: { roundNumber: 1, name: 'Rodada Default', tenantId: tenant.id, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' },
    });
    await prisma.round.create({
      data: {
        roundNumber: 1,
        tenantId: tenant.id,
        territoryId: territory.id,
        blockId: block.id,
        houseId: house.id,
        mode: 'default',
        completed: false,
        startDate: dayjs().subtract(3, 'months').toDate(),
        endDate: dayjs().subtract(2, 'months').toDate(),
      },
    });

    // Rodada campaign com casa visitada (não deve cancelar a carta)
    await prisma.round_info.create({
      data: { roundNumber: 2, name: 'Rodada Campanha', tenantId: tenant.id, theme: 'campaign', colorPrimary: '#000', colorSecondary: '#fff' },
    });
    await prisma.round.create({
      data: {
        roundNumber: 2,
        tenantId: tenant.id,
        territoryId: territory.id,
        blockId: block.id,
        houseId: house.id,
        mode: 'campaign',
        completed: true,
        completedDate: dayjs().subtract(1, 'months').toDate(),
        startDate: dayjs().subtract(2, 'months').toDate(),
        endDate: dayjs().subtract(1, 'months').toDate(),
      },
    });

    const res = await abrirRodada(token, type.id, 'default');

    expect(res.status).toBe(201);

    const novaRodada = await prisma.round.findFirst({ where: { tenantId: tenant.id, roundNumber: 3 } });
    // Casa sem visitas em rounds default → carta (campaign não cancela)
    expect(novaRodada?.leaveLetter).toBe(true);
  });
});
