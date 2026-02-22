import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { AddressBlockService } from '../src/modules/block/adress-block.service';

describe('Ghost House Flow (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let cacheManager: Cache;
    let addressBlockService: AddressBlockService;

    beforeAll(async () => {
        app = await createTestApp();
        prisma = app.get(PrismaService);
        cacheManager = app.get(CACHE_MANAGER);
        addressBlockService = app.get(AddressBlockService);
        await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        await cleanDatabase(prisma);
    });

    it('should create a ghost house when a new address is added to a block', async () => {
        // Arrange
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: {
                name: 'Territory 1',
                typeId: type.id,
                tenantId: tenant.id,
            },
        });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // Act: Create a block with one address
        const response = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Block A',
                addresses: [
                    { street: 'Rua Fantasma', zipCode: '12345678' }
                ]
            });

        expect(response.status).toBe(201);

        // Assert: Check if a ghost house was created
        const ghostHouse = await prisma.house.findFirst({
            where: {
                number: 'ghost',
                tenantId: tenant.id,
                address: { name: 'Rua Fantasma' }
            }
        });

        expect(ghostHouse).toBeDefined();
        expect(ghostHouse?.number).toBe('ghost');

        // Assert: Check if rounds were created for the ghost house
        const rounds = await prisma.round.findMany({
            where: { houseId: ghostHouse?.id }
        });
        expect(rounds.length).toBeGreaterThan(0);
        expect(rounds[0].completed).toBe(true);
    });

    it('should remove ghost house when a real house is approved via report', async () => {
        // Arrange
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Territory 1', typeId: type.id, tenantId: tenant.id },
        });
        const adminToken = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // 1. Setup: Block with ghost house
        const blockSetup = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Block A',
                addresses: [{ street: 'Rua Real', zipCode: '12345678' }]
            });

        const blockId = blockSetup.body.id;
        const addressId = blockSetup.body.addresses[0].id;
        const territoryBlockAddressId = (await prisma.territory_block_address.findFirst({
            where: { addressId, tenantId: tenant.id }
        }))?.id;

        const ghostHouseBefore = await prisma.house.findFirst({
            where: { number: 'ghost', territoryBlockAddressId }
        });
        expect(ghostHouseBefore).toBeDefined();

        // 2. Act: Create a report for a REAL house in the same address
        const reportResponse = await request(app.getHttpServer())
            .post('/v1/reports')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                territoryId: territory.id,
                blockId: blockId,
                addressId: addressId,
                territoryBlockAddressId: territoryBlockAddressId,
                number: '123',
                legend: 'House 123',
                reportType: 'add',
                observations: 'New house added'
            });

        expect(reportResponse.status).toBe(201);
        const reportId = reportResponse.body.id;

        // 3. Act: Approve the report
        const approveResponse = await request(app.getHttpServer())
            .post(`/v1/reports/approve/${reportId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send();

        expect(approveResponse.status).toBe(201);

        // 4. Assert: Check if the ghost house was removed
        const ghostHouseAfter = await prisma.house.findFirst({
            where: { number: 'ghost', territoryBlockAddressId }
        });
        expect(ghostHouseAfter).toBeNull();
    });

    it('should sync ghost houses on demand when accessing block details', async () => {
        // Arrange
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Territory 1', typeId: type.id, tenantId: tenant.id },
        });
        const block = await prisma.block.create({ data: { name: 'Block Test', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'Street Test', tenantId: tenant.id } });
        const tb = await prisma.territory_block.create({
            data: {
                territoryId: territory.id,
                blockId: block.id,
                tenantId: tenant.id
            }
        });
        const tba = await prisma.territory_block_address.create({
            data: {
                addressId: address.id,
                territoryBlockId: tb.id,
                tenantId: tenant.id
            }
        });

        // 1. Manually satisfy the requirement for ghost house creation but don't create it yet
        // A TBA with no houses should have a ghost house CREATED ON DEMAND.
        // We ensure no house exists before the API call.
        await prisma.house.deleteMany({
            where: { territoryBlockAddressId: tba.id }
        });

        let ghostHouse = await prisma.house.findFirst({
            where: { territoryBlockAddressId: tba.id, number: 'ghost' }
        });
        expect(ghostHouse).toBeNull();

        // We need a signature to access the block
        const signature = await prisma.signature.create({
            data: {
                key: 'test-key',
                token: createTestToken({
                    territoryId: territory.id,
                    round: 1,
                    tenantId: tenant.id,
                    roles: [Role.DIRIGENTE]
                }),
                expirationDate: new Date(Date.now() + 100000),
                tenantId: tenant.id
            }
        });
        await prisma.territory_block.update({
            where: { id: tb.id },
            data: { signatureId: signature.id }
        });

        const overseerToken = createTestToken({ tenantId: tenant.id, roles: [Role.DIRIGENTE] });

        // Act: Access block details
        const response = await request(app.getHttpServer())
            .get(`/v1/territories/${territory.id}/blocks/${block.id}?round=1`)
            .set('Authorization', `Bearer ${overseerToken}`);

        expect(response.status).toBe(200);

        // 2. Now add a real house and verify cleanup on next access
        const realHouse = await prisma.house.create({
            data: {
                number: '100',
                territoryId: territory.id,
                blockId: block.id,
                addressId: address.id,
                tenantId: tenant.id,
                territoryBlockAddressId: tba.id
            }
        });

        // Invalidate caches to ensure sync runs on next access
        await cacheManager.del(`addresses:${territory.id}:${block.id}`);
        await addressBlockService.invalidateSyncGhostCache(tenant.id, territory.id, block.id);

        // Act: Access again - using cacheBuster to bypass global CacheInterceptor and trigger another sync
        const response2 = await request(app.getHttpServer())
            .get(`/v1/territories/${territory.id}/blocks/${block.id}?round=1&cacheBuster=${Date.now()}`)
            .set('Authorization', `Bearer ${overseerToken}`);

        expect(response2.status).toBe(200);

        // Assert: Ghost house should have been cleaned up on demand
        ghostHouse = await prisma.house.findFirst({
            where: { territoryBlockAddressId: tba.id, number: 'ghost' }
        });
        expect(ghostHouse).toBeNull();
    });
});
