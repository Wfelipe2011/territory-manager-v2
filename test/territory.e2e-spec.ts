import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';

describe('Territory Flow (e2e)', () => {
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

    it('should create, update and list territories', async () => {
        // Arrange
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // 1. Create
        const createResponse = await request(app.getHttpServer())
            .post('/v1/territories')
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'New Territory',
                typeId: type.id,
            });

        expect(createResponse.status).toBe(201);
        const territoryId = createResponse.body.id;

        // 2. Update
        const updateResponse = await request(app.getHttpServer())
            .put(`/v1/territories/${territoryId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                id: territoryId,
                name: 'Updated Territory',
                typeId: type.id,
            });

        expect(updateResponse.status).toBe(200);

        // 3. List
        // Create Block
        const block = await prisma.block.create({
            data: { name: 'Block 1', tenantId: tenant.id },
        });

        // Create Address
        const address = await prisma.address.create({
            data: { name: 'Street 1', tenantId: tenant.id },
        });

        // Create House
        const house = await prisma.house.create({
            data: {
                number: '100',
                blockId: block.id,
                addressId: address.id,
                territoryId: territoryId,
                tenantId: tenant.id,
            },
        });

        // Create Round
        await prisma.round.create({
            data: {
                roundNumber: 1,
                territoryId: territoryId,
                blockId: block.id,
                houseId: house.id,
                tenantId: tenant.id,
                completed: false,
            },
        });

        const listResponse = await request(app.getHttpServer())
            .get('/v1/territories?round=1')
            .set('Authorization', `Bearer ${token}`);

        expect(listResponse.status).toBe(200);
        expect(listResponse.body.length).toBeGreaterThan(0);
        expect(listResponse.body[0].name).toBe('Updated Territory');
    });
});
