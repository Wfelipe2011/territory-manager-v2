import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { uuid } from '../src/shared';
import * as jwt from 'jsonwebtoken';

describe('Offline Sync Flow (e2e)', () => {
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

    it('should restrict snapshot and sync to assigned block for Publisher role', async () => {
        // Arrange
        const tenant = await prisma.multitenancy.create({ data: { name: 'Offline Tenant' } });
        const type = await prisma.type.create({ data: { name: 'Residencial', tenantId: tenant.id } });
        const territory = await prisma.territory.create({ data: { name: 'T1', tenantId: tenant.id, typeId: type.id } });

        // Two blocks in the territory
        const block1 = await prisma.block.create({ data: { name: 'Block 1', tenantId: tenant.id } });
        const block2 = await prisma.block.create({ data: { name: 'Block 2', tenantId: tenant.id } });

        const address = await prisma.address.create({ data: { name: 'Street 1', tenantId: tenant.id } });

        // Link Block 1
        const tb1 = await prisma.territory_block.create({ data: { territoryId: territory.id, blockId: block1.id, tenantId: tenant.id } });
        const tba1 = await prisma.territory_block_address.create({ data: { territoryBlockId: tb1.id, addressId: address.id, tenantId: tenant.id } });
        const house1 = await prisma.house.create({
            data: { number: '100', tenantId: tenant.id, territoryBlockAddressId: tba1.id, blockId: block1.id, territoryId: territory.id, addressId: address.id }
        });

        // Link Block 2
        const tb2 = await prisma.territory_block.create({ data: { territoryId: territory.id, blockId: block2.id, tenantId: tenant.id } });
        const tba2 = await prisma.territory_block_address.create({ data: { territoryBlockId: tb2.id, addressId: address.id, tenantId: tenant.id } });
        const house2 = await prisma.house.create({
            data: { number: '200', tenantId: tenant.id, territoryBlockAddressId: tba2.id, blockId: block2.id, territoryId: territory.id, addressId: address.id }
        });

        const roundNumber = 1;
        const signatureKey = uuid();

        // Create a JWT token for BLOCK 1 ONLY
        const tokenPayload = {
            id: signatureKey,
            blockId: block1.id,
            territoryId: territory.id,
            tenantId: tenant.id,
            round: roundNumber,
            roles: ['PUBLICADOR']
        };
        const token = jwt.sign(tokenPayload, 'test_secret'); // In test env JWT_SECRET is test_secret

        const signature = await prisma.signature.create({
            data: {
                key: signatureKey,
                token: token,
                expirationDate: new Date(Date.now() + 10000000),
                tenantId: tenant.id
            }
        });

        // Connect signature to Block 1 (usually done by service, doing manually here)
        await prisma.territory_block.update({
            where: { id: tb1.id },
            data: { signatureId: signature.id }
        });

        // Act 1: Get Snapshot
        const snapshotRes = await request(app.getHttpServer())
            .get(`/v2/offline/snapshot/${territory.id}`)
            .query({ signature: signatureKey })
            .expect(200);

        // Assert 1: Only Block 1 should be returned
        expect(snapshotRes.body.blocks).toHaveLength(1);
        expect(snapshotRes.body.blocks[0].id).toBe(block1.id);
        expect(snapshotRes.body.blocks[0].addresses[0].houses[0].id).toBe(house1.id);

        // Act 2: Sync Visits (Try to sync House 2 which is in Block 2)
        const visitDate = new Date().toISOString();
        const syncPayload = {
            territoryId: territory.id,
            changes: [
                { houseId: house2.id, status: true, date: visitDate }, // Should be ignored
                { houseId: house1.id, status: true, date: visitDate }  // Should be accepted
            ]
        };

        await request(app.getHttpServer())
            .post('/v2/offline/sync')
            .query({ signature: signatureKey })
            .send(syncPayload)
            .expect(201);

        // Assert 2: House 1 updated, House 2 NOT updated
        const roundEntry1 = await prisma.round.findFirst({
            where: { houseId: house1.id, roundNumber: roundNumber }
        });
        expect(roundEntry1?.completed).toBe(true);

        const roundEntry2 = await prisma.round.findFirst({
            where: { houseId: house2.id, roundNumber: roundNumber }
        });
        expect(roundEntry2).toBeNull();
    });
});
