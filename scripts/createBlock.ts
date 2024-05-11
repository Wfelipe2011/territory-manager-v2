import { multitenancy, block } from '@prisma/client';
import { PrismaTransaction, Row } from './main';

export async function createBlock(row: Row, tenant: multitenancy, txt: PrismaTransaction): Promise<block> {
  let block = await txt.block.findFirst({
    where: {
      name: 'Quadra ' + row.Quadra,
      tenantId: tenant.id,
    },
  });
  if (!block) {
    block = await txt.block.create({
      data: {
        name: 'Quadra ' + row.Quadra,
        multitenancy: {
          connect: {
            id: tenant.id,
          },
        },
      },
    });
  }
  return block;
}
