import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';

describe('Delete Territory (e2e)', () => {
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

    it('should delete a territory and all related entities', async () => {
        // 1. Arrange: Create Tenant, Type, Territory
        const tenant = await prisma.multitenancy.create({ data: { name: 'Delete Territory Tenant' } });
        const type = await prisma.type.create({ data: { name: 'Type A', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'To Be Deleted', tenantId: tenant.id, typeId: type.id },
        });

        // Create Dependencies
        const block = await prisma.block.create({ data: { name: 'Block D1', tenantId: tenant.id } });

        // Territory Block
        const territoryBlock = await prisma.territory_block.create({
            data: { territoryId: territory.id, blockId: block.id, tenantId: tenant.id },
        });

        // Address
        const address = await prisma.address.create({ data: { name: 'Street D1', tenantId: tenant.id } });

        // Territory Block Address
        const tba = await prisma.territory_block_address.create({
            data: {
                territoryBlockId: territoryBlock.id,
                addressId: address.id,
                tenantId: tenant.id,
            },
        });

        // House
        const house = await prisma.house.create({
            data: {
                number: '101',
                blockId: block.id, // Legacy/Required
                addressId: address.id, // Legacy/Required
                territoryId: territory.id, // Legacy/Required
                territoryBlockAddressId: tba.id,
                tenantId: tenant.id,
            },
        });

        // Round
        await prisma.round.create({
            data: {
                roundNumber: 1,
                territoryId: territory.id,
                blockId: block.id,
                houseId: house.id,
                tenantId: tenant.id,
                completed: false,
            },
        });

        // Territory Overseer
        await prisma.territory_overseer.create({
            data: {
                territoryId: territory.id,
                overseer: 'Overseer X',
                initialDate: new Date(),
                // finished: false, // Default is false
                roundNumber: 1,
                tenantId: tenant.id,
            },
        });

        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // 2. Act: Call Delete Endpoint
        const response = await request(app.getHttpServer())
            .delete(`/v1/territories/${territory.id}`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(204);

        // 3. Assert: Verify deletion
        const territoryCheck = await prisma.territory.findUnique({ where: { id: territory.id } });
        expect(territoryCheck).toBeNull();

        const roundCheck = await prisma.round.findFirst({ where: { territoryId: territory.id } });
        expect(roundCheck).toBeNull();

        const houseCheck = await prisma.house.findUnique({ where: { id: house.id } });
        expect(houseCheck).toBeNull();

        const tbaCheck = await prisma.territory_block_address.findUnique({ where: { id: tba.id } });
        expect(tbaCheck).toBeNull();

        const tbCheck = await prisma.territory_block.findUnique({ where: { id: territoryBlock.id } });
        expect(tbCheck).toBeNull();

        const overseerCheck = await prisma.territory_overseer.findFirst({ where: { territoryId: territory.id } });
        expect(overseerCheck).toBeNull();

        // Block and Address should typically remain if they are shared, but current logic deletes territory_block. 
        // They are independent entities technically. 
        // The implementation did NOT delete `block` or `address` entities themselves, only the links.
        // Let's verify they exist (optional, but confirms scope).
        const blockCheck = await prisma.block.findUnique({ where: { id: block.id } });
        expect(blockCheck).not.toBeNull();
    });
});
