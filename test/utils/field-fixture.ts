import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/infra/prisma/prisma.service';
import { SignatureService } from '../../src/modules/signature/signature.service';
import { createTestToken } from './auth-helper';
import { randomUUID } from 'crypto';

export async function fieldFixture(app: INestApplication) {
  const prisma = app.get(PrismaService);
  const signatures = app.get(SignatureService);
  const tenant = await prisma.multitenancy.create({ data: { name: 'QA Campo', city: 'Sorocaba', state: 'SP' } });
  const type = await prisma.type.create({ data: { name: 'Residencial', tenantId: tenant.id } });
  const territory = await prisma.territory.create({ data: { name: 'QA Território', typeId: type.id, tenantId: tenant.id } });
  const block = await prisma.block.create({ data: { name: 'Quadra QA', tenantId: tenant.id } });
  const address = await prisma.address.create({ data: { name: 'Rua QA', tenantId: tenant.id } });
  const tb = await prisma.territory_block.create({ data: { territoryId: territory.id, blockId: block.id, tenantId: tenant.id } });
  const tba = await prisma.territory_block_address.create({ data: { territoryBlockId: tb.id, addressId: address.id, tenantId: tenant.id } });
  const house = await prisma.house.create({ data: { number: '12', legend: 'Residência', territoryId: territory.id, blockId: block.id, addressId: address.id, territoryBlockAddressId: tba.id, tenantId: tenant.id } });
  await prisma.round_info.create({ data: { roundNumber: 1, name: 'Rodada QA', tenantId: tenant.id, theme: 'default' } });
  await prisma.round.create({ data: { roundNumber: 1, territoryId: territory.id, blockId: block.id, houseId: house.id, tenantId: tenant.id, completed: false } });
  const leader = await signatures.generateTerritory({ territoryId: territory.id, tenantId: tenant.id, round: 1, overseer: 'Dirigente QA', expirationTime: '2099-12-31' });
  const publisher = await signatures.generateTerritoryBlock({ territoryId: territory.id, blockId: block.id, tenantId: tenant.id, round: 1 });
  const leaderAccess = await signatures.findTokenById(leader.signature);
  const publisherAccess = await signatures.findTokenById(publisher.signature);
  const adminToken = createTestToken({ tenantId: tenant.id });
  const identity = { clientId: randomUUID(), tabId: randomUUID() };
  const query = { ...identity, scope: 'street', blockId: String(block.id), addressId: String(address.id) };
  const patchPath = `/v1/territories/${territory.id}/blocks/${block.id}/address/${address.id}/houses/${house.id}`;
  return { prisma, signatures, tenant, type, territory, block, address, house, leader, publisher, leaderAccess, publisherAccess, adminToken, identity, query, patchPath };
}
