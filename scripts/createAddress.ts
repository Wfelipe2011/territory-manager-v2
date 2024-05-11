import { multitenancy, address } from '@prisma/client';
import { Row, PrismaTransaction } from './main';

export async function createAddress(row: Row, tenant: multitenancy, txt: PrismaTransaction): Promise<address> {
  let address = await txt.address.findFirst({
    where: {
      name: row.Logradouro,
      tenantId: tenant.id,
    },
  });
  if (!address) {
    address = await txt.address.create({
      data: {
        name: row.Logradouro,
        multitenancy: {
          connect: {
            id: tenant.id,
          },
        },
      },
    });
  }
  return address;
}
