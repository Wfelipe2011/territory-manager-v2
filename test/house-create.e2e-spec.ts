import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';

/**
 * REGRAS definidas para o POST /v1/houses (criar casa):
 * 1. Duplicidade: segundo POST com o mesmo number no mesmo TBA -> 409 Conflict.
 * 2. Refresco: após o POST, a listagem (GET) reflete a casa nova imediatamente
 *    (caches invalidados e/ou não utilizados para essa listagem).
 * 3. Ghost: criar casa real no endereço de um ghost remove o ghost (house+rounds).
 * 4. Sincronização: o POST incrementa a revisão HTTP da quadra.
 */
describe('House create (e2e) — duplicidade, refresh, ghost e revisão HTTP', () => {
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

  async function criarRodadaAberta(tenantId: number, ctx: { territoryId: number; blockId: number; addressId: number; tbaId: number }) {
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
      data: { roundNumber: 1, name: 'Rodada 1', tenantId, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' },
    });
    await prisma.round.create({
      data: {
        roundNumber: 1,
        tenantId,
        territoryId: ctx.territoryId,
        blockId: ctx.blockId,
        houseId: dummy.id,
        completed: false,
      },
    });
  }

  async function postCasa(token: string, blockId: number, addressId: number, territoryId: number, number: string) {
    return request(app.getHttpServer())
      .post('/v1/houses')
      .set('Authorization', `Bearer ${token}`)
      .send({ number, blockId, streetId: addressId, territoryId, dontVisit: false, legend: '' });
  }

  async function getCasas(token: string, territoryId: number, blockId: number, addressId: number) {
    return request(app.getHttpServer())
      .get(`/v1/territories/${territoryId}/blocks/${blockId}/address/${addressId}?round=1`)
      .set('Authorization', `Bearer ${token}`);
  }

  it('segundo POST com o mesmo número no mesmo TBA: deve retornar 409 e NÃO criar segunda casa', async () => {
    const { tenant, type, territory, block, address, tba, token } = await criarEstrutura('Duplicidade');
    await criarRodadaAberta(tenant.id, { territoryId: territory.id, blockId: block.id, addressId: address.id, tbaId: tba.id });

    const first = await postCasa(token, block.id, address.id, territory.id, '12');
    expect(first.status).toBe(201);

    const second = await postCasa(token, block.id, address.id, territory.id, '12');
    expect(second.status).toBe(409);

    const casas = await prisma.house.findMany({ where: { tenantId: tenant.id, territoryBlockAddressId: tba.id } });
    expect(casas.filter(h => h.number === '12').length).toBe(1);
  });

  it('GET antes do POST e GET imediato após o POST: a casa nova deve aparecer na listagem', async () => {
    const { tenant, type, territory, block, address, tba, token } = await criarEstrutura('Refresh');
    await criarRodadaAberta(tenant.id, { territoryId: territory.id, blockId: block.id, addressId: address.id, tbaId: tba.id });

    // Popula o cache da listagem antes do POST
    const antes = await getCasas(token, territory.id, block.id, address.id);
    expect(antes.status).toBe(200);

    const post = await postCasa(token, block.id, address.id, territory.id, '12');
    expect(post.status).toBe(201);

    // GET imediato deve refletir a casa nova (sem cache stale)
    const depois = await getCasas(token, territory.id, block.id, address.id);
    expect(depois.status).toBe(200);
    const numbers = depois.body.houses.map((h: { number: string }) => h.number);
    expect(numbers).toContain('12');
  });

  it('POST em endereço com ghost: deve remover o ghost (house + rounds) e manter só a casa real', async () => {
    const { tenant, type, territory, block, address, tba, token } = await criarEstrutura('Ghost Cleanup');
    await criarRodadaAberta(tenant.id, { territoryId: territory.id, blockId: block.id, addressId: address.id, tbaId: tba.id });

    // Ghost no mesmo TBA (padrão do createGhostHouse: completed=true)
    const ghost = await prisma.house.create({
      data: {
        number: 'ghost',
        blockId: block.id,
        addressId: address.id,
        territoryId: territory.id,
        tenantId: tenant.id,
        territoryBlockAddressId: tba.id,
      },
    });
    await prisma.round.create({
      data: { roundNumber: 1, tenantId: tenant.id, territoryId: territory.id, blockId: block.id, houseId: ghost.id, completed: true },
    });

    const post = await postCasa(token, block.id, address.id, territory.id, '12');
    expect(post.status).toBe(201);

    const casas = await prisma.house.findMany({ where: { tenantId: tenant.id, territoryBlockAddressId: tba.id } });
    expect(casas.filter(h => h.number === '12').length).toBe(1);
    expect(casas.some(h => h.number === 'ghost')).toBe(false);

    const roundsGhost = await prisma.round.findMany({ where: { houseId: ghost.id } });
    expect(roundsGhost.length).toBe(0);
  });

  it('POST deve incrementar a revisão HTTP da quadra na rodada aberta', async () => {
    const { tenant, type, territory, block, address, tba, token } = await criarEstrutura('Evento');
    await criarRodadaAberta(tenant.id, { territoryId: territory.id, blockId: block.id, addressId: address.id, tbaId: tba.id });

    const before = await prisma.$queryRaw<{ revision: bigint }[]>`SELECT revision FROM field_revision WHERE tenant_id = ${tenant.id} AND territory_id = ${territory.id} AND round_number = 1 AND block_id = ${block.id}`;

    const post = await postCasa(token, block.id, address.id, territory.id, '12');
    expect(post.status).toBe(201);

    const after = await prisma.$queryRaw<{ revision: bigint }[]>`SELECT revision FROM field_revision WHERE tenant_id = ${tenant.id} AND territory_id = ${territory.id} AND round_number = 1 AND block_id = ${block.id}`;
    expect(after[0].revision > before[0].revision).toBe(true);
  });
});
