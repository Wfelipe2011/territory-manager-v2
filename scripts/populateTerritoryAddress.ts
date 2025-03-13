import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

(async () => {
    await prisma.$connect();
    // select distinct h.territory_id, h.block_id, h.address_id, h.tenant_id from house h 
    // group by h.territory_id, h.block_id, h.address_id, h.tenant_id
    const distinctHouses = await prisma.house.findMany({
        distinct: ['territoryId', 'blockId', 'addressId', 'tenantId'],
        select: {
            territoryId: true,
            blockId: true,
            addressId: true,
            tenantId: true
        }
    });

    for (const house of distinctHouses) {
        await prisma.$transaction(async (tsx) => {
            console.log(`Processing house: ${house.territoryId} - ${house.blockId} - ${house.addressId} - ${house.tenantId}`);
            const territoryBlock = await tsx.territory_block.findUnique({
                where: {
                    territoryId_blockId: {
                        territoryId: house.territoryId,
                        blockId: house.blockId
                    }
                }
            });

            if (!territoryBlock) {
                return new Promise(async (resolve) => resolve(true));
            }

            const territoryAddress = await tsx.territory_block_address.create({
                data: {
                    addressId: house.addressId,
                    tenantId: house.tenantId,
                    territoryBlockId: territoryBlock.id
                }
            });
            await tsx.house.updateMany({
                where: {
                    territoryId: house.territoryId,
                    blockId: house.blockId,
                    addressId: house.addressId,
                    tenantId: house.tenantId
                },
                data: {
                    territoryBlockAddressId: territoryAddress.id
                }
            });
            console.log(`Territory address created: ${territoryAddress.id}`);
        }, {
            maxWait: 1000 * 60 * 10, // 10 minutes,
            timeout: 1000 * 60 * 10 // 10 minutes
        }).catch((err) => {
            console.error(err);
        });
        console.log('Territory addresses populated');
    }
})();