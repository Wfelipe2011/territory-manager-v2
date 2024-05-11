import { multitenancy } from '@prisma/client';
import { PrismaTransaction, prisma } from './main';

export async function createTenant(name: string, phone: string, txt: PrismaTransaction): Promise<multitenancy> {
  let tenant = await txt.multitenancy.findFirst({
    where: {
      name: name,
      phone: phone,
    },
  });
  if (!tenant) {
    tenant = await txt.multitenancy.create({
      data: {
        name,
        phone,
      },
    });
  }
  return tenant;
}

export async function deleteCascateTenant(tenantId: number) {
  await prisma.$transaction(async txt => {
    await txt.house.deleteMany({ where: { tenantId } });
    await txt.round.deleteMany({ where: { tenantId } });
    await txt.territory_block.deleteMany({ where: { tenantId } });
    await txt.territory.deleteMany({ where: { tenantId } });
    await txt.block.deleteMany({ where: { tenantId } });
    await txt.type.deleteMany({ where: { tenantId } });
    await txt.address.deleteMany({ where: { tenantId } });
    await txt.user.deleteMany({ where: { tenantId } });
    await txt.multitenancy.delete({ where: { id: tenantId } });
  });
}
