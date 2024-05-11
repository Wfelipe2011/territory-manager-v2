import { block, house, multitenancy, territory } from '@prisma/client';
import { PrismaTransaction } from './main';

export async function createTerritoryBlock(territory: territory, block: block, house: house, tenant: multitenancy, txt: PrismaTransaction) {
  let territoryBlock = await txt.territory_block.findUnique({
    where: {
      territoryId_blockId: {
        territoryId: territory.id,
        blockId: block.id,
      },
    },
  });
  if (!territoryBlock) {
    territoryBlock = await txt.territory_block.create({
      data: {
        territory: {
          connect: {
            id: territory.id,
          },
        },
        block: {
          connect: {
            id: house.blockId,
          },
        },
        multitenancy: {
          connect: {
            id: tenant.id,
          },
        },
      },
    });
  }
}
