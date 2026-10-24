import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { fieldFixture } from './utils/field-fixture';

describe('Catálogo da quadra com consulta restrita ao escopo', () => {
  let app: INestApplication;
  let ctx: Awaited<ReturnType<typeof fieldFixture>>;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await cleanDatabase(app.get(PrismaService)); ctx = await fieldFixture(app); });
  const read = () => request(app.getHttpServer()).get(`/v1/field/blocks/${ctx.block.id}/sync`).set('Authorization', `Bearer ${ctx.publisherAccess.token}`).query(ctx.identity);
  const rows = (response: request.Response) => response.body.data.streets.flatMap(street => street.houses);

  it('mantém casas provisórias sob rua provisória e casas legadas sem rodada', async () => {
    const tb = await ctx.prisma.territory_block.findFirstOrThrow({ where: { territoryId: ctx.territory.id, blockId: ctx.block.id } });
    const address = await ctx.prisma.address.create({ data: { tenantId: ctx.tenant.id, name: 'Rua provisória' } });
    const mapping = await ctx.prisma.territory_block_address.create({ data: { tenantId: ctx.tenant.id, territoryBlockId: tb.id, addressId: address.id, registrationStatus: 'pending' } });
    const common = { tenantId: ctx.tenant.id, territoryId: ctx.territory.id, blockId: ctx.block.id, addressId: address.id };
    const provisional = await ctx.prisma.house.create({ data: { ...common, number: '2', territoryBlockAddressId: mapping.id, registrationStatus: 'pending' } });
    const legacy = await ctx.prisma.house.create({ data: { ...common, number: '10' } });
    const response = await read().expect(200);
    expect(rows(response)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ctx.house.id, hasRound: true, canMark: true }),
      expect.objectContaining({ id: provisional.id, registrationStatus: 'pending', hasRound: false }),
      expect.objectContaining({ id: legacy.id, hasRound: false }),
    ]));
    expect(response.body.data.streets.find(street => street.id === address.id).houses.map(house => house.number)).toEqual(['2', '10']);
  });

  it('exclui casas rejeitadas, fantasmas e vínculos rejeitados ou de outra quadra', async () => {
    const original = await ctx.prisma.house.findUniqueOrThrow({ where: { id: ctx.house.id } });
    const common = { tenantId: ctx.tenant.id, territoryId: ctx.territory.id, blockId: ctx.block.id, addressId: ctx.address.id };
    await ctx.prisma.house.create({ data: { ...common, number: '99', registrationStatus: 'rejected', territoryBlockAddressId: original.territoryBlockAddressId } });
    await ctx.prisma.house.create({ data: { ...common, number: 'ghost' } });
    const otherBlock = await ctx.prisma.block.create({ data: { tenantId: ctx.tenant.id, name: 'Outra quadra' } });
    const otherTb = await ctx.prisma.territory_block.create({ data: { tenantId: ctx.tenant.id, territoryId: ctx.territory.id, blockId: otherBlock.id } });
    const foreign = await ctx.prisma.territory_block_address.create({ data: { tenantId: ctx.tenant.id, territoryBlockId: otherTb.id, addressId: ctx.address.id } });
    await ctx.prisma.house.create({ data: { ...common, number: '100', territoryBlockAddressId: foreign.id } });
    const address = await ctx.prisma.address.create({ data: { tenantId: ctx.tenant.id, name: 'Rua rejeitada' } });
    const tb = await ctx.prisma.territory_block.findFirstOrThrow({ where: { territoryId: ctx.territory.id, blockId: ctx.block.id } });
    const rejected = await ctx.prisma.territory_block_address.create({ data: { tenantId: ctx.tenant.id, territoryBlockId: tb.id, addressId: address.id, registrationStatus: 'rejected' } });
    await ctx.prisma.house.create({ data: { ...common, number: '101', addressId: address.id, territoryBlockAddressId: rejected.id } });
    expect(rows(await read().expect(200)).map(house => house.id)).toEqual([ctx.house.id]);
  });
});
