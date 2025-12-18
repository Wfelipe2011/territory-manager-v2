import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';

describe('Round Lifecycle (e2e)', () => {
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

    it('should start and finish a round', async () => {
        // Arrange
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // Create a territory to be included in the round
        const territory = await prisma.territory.create({
            data: { name: 'Territory 1', tenantId: tenant.id, typeId: type.id },
        });

        // Create Block
        const block = await prisma.block.create({
            data: { name: 'Block 1', tenantId: tenant.id },
        });

        // Create Address
        const address = await prisma.address.create({
            data: { name: 'Street 1', tenantId: tenant.id },
        });

        // Create House (Required for round creation)
        await prisma.house.create({
            data: {
                number: '100',
                blockId: block.id,
                addressId: address.id,
                territoryId: territory.id,
                tenantId: tenant.id,
            },
        });

        // 1. Start Round
        const startResponse = await request(app.getHttpServer())
            .post('/v1/rounds/start')
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'New Round',
                typeId: type.id,
                theme: 'default',
                colorPrimary: '#7AAD58',
                colorSecondary: '#7AAD58',
            });

        expect(startResponse.status).toBe(201);

        // 2. Verify Round Info
        const infoResponse = await request(app.getHttpServer())
            .get('/v1/rounds/info')
            .set('Authorization', `Bearer ${token}`);

        expect(infoResponse.status).toBe(200);
        expect(infoResponse.body.length).toBeGreaterThan(0);
        const roundNumber = infoResponse.body[0].round_number;

        // 3. Finish Round
        const finishResponse = await request(app.getHttpServer())
            .post('/v1/rounds/finish')
            .set('Authorization', `Bearer ${token}`)
            .send({
                roundNumber: roundNumber,
            });

        expect(finishResponse.status).toBe(201);
    });

    it('should get round info by round number', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant Info' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Territory 1', tenantId: tenant.id, typeId: type.id },
        });
        const block = await prisma.block.create({ data: { name: 'Block 1', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'Street 1', tenantId: tenant.id } });
        const house = await prisma.house.create({
            data: { number: '1', blockId: block.id, addressId: address.id, territoryId: territory.id, tenantId: tenant.id },
        });

        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });
        await prisma.round_info.create({
            data: {
                name: 'Round 1',
                roundNumber: 1,
                tenantId: tenant.id,
                theme: 'default',
                colorPrimary: '#000',
                colorSecondary: '#fff',
            },
        });

        await prisma.round.create({
            data: {
                roundNumber: 1,
                tenantId: tenant.id,
                territoryId: territory.id,
                blockId: block.id,
                houseId: house.id,
                completed: false,
            },
        });

        const response = await request(app.getHttpServer())
            .get('/v1/rounds/info/1')
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.round_number).toBe(1);
    });

    it('should get theme round', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant Theme' } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });
        await prisma.round_info.create({
            data: {
                name: 'Round 1',
                roundNumber: 1,
                tenantId: tenant.id,
                theme: 'campaign',
                colorPrimary: '#000',
                colorSecondary: '#fff',
            },
        });

        const response = await request(app.getHttpServer())
            .get('/v1/rounds/theme/1')
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.theme).toBe('campaign');
    });

    it('should fix round info', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant Fix' } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        const response = await request(app.getHttpServer())
            .get('/v1/rounds/fix-round-info')
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
    });

    it('should fail to finish round without round number', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant Fail' } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        const response = await request(app.getHttpServer())
            .post('/v1/rounds/finish')
            .set('Authorization', `Bearer ${token}`)
            .send({});

        expect(response.status).toBe(500); // Based on the controller code throwing a generic Error
    });
});
