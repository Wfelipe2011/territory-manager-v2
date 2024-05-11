import { multitenancy, territory, type } from '@prisma/client';
import { PrismaTransaction } from './main';

export async function createTerritory(nameTerritory: string, type: type, tenant: multitenancy, txt: PrismaTransaction): Promise<territory> {
  let territory = await txt.territory.findFirst({
    where: {
      name: nameTerritory,
      typeId: type.id,
      tenantId: tenant.id,
    },
  });
  if (!territory) {
    territory = await txt.territory.create({
      data: {
        name: nameTerritory,
        multitenancy: {
          connect: {
            id: tenant.id,
          },
        },
        type: {
          connect: {
            id: type.id,
          },
        },
      },
    });
  }
  return territory;
}
