import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';

describe('Ghost House Flow (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    beforeAll(async () => {
        app = await createTestApp();
        prisma = app.get(PrismaService);
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
    });
});
