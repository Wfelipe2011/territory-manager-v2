import { multitenancy, type } from '@prisma/client';
import { Row, PrismaTransaction } from './main';

export async function createType(tenant: multitenancy, row: Row, txt: PrismaTransaction): Promise<type> {
  let type = await txt.type.findFirst({
    where: {
      name: row.TipoTerritorio,
      tenantId: tenant.id,
    },
  });
  if (!type) {
    type = await txt.type.create({
      data: {
        name: row.TipoTerritorio,
        tenantId: tenant.id,
      },
    });
  }
  return type;
}
