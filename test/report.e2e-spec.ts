import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { createTestApp } from './utils/app-helper';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';
import { cleanDatabase } from './utils/db-cleaner';

describe('Report Flow (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    beforeAll(async () => {
        app = await createTestApp();
        prisma = app.get<PrismaService>(PrismaService);
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        await cleanDatabase(prisma);
    });

    it('should manage reports (create and list)', async () => {
        const tenant = await prisma.multitenancy.create({
            data: { name: 'Test Tenant', city: 'Test City', state: 'TS' },
        });

        const type = await prisma.type.create({
            data: { name: 'Residencial', tenantId: tenant.id },
        });

        const territory = await prisma.territory.create({
            data: { name: 'Territory 1', typeId: type.id, tenantId: tenant.id },
        });

        const block = await prisma.block.create({
            data: { name: 'Block A', tenantId: tenant.id },
        });

        const address = await prisma.address.create({
            data: { name: 'Street A', tenantId: tenant.id },
        });

        const publisherToken = createTestToken({ tenantId: tenant.id, roles: [Role.PUBLICADOR] });
        const adminToken = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // 1. Create a report (suggest adding a house)
        const createReportResponse = await request(app.getHttpServer())
            .post('/v1/reports')
            .set('Authorization', `Bearer ${publisherToken}`)
            .send({
                territoryId: territory.id,
                blockId: block.id,
                addressId: address.id,
                number: '200',
                legend: 'New House',
                observations: 'Please add this house',
                reportType: 'add',
            });

        expect(createReportResponse.status).toBe(201);

        // 2. List reports (Admin)
        const listReportsResponse = await request(app.getHttpServer())
            .get('/v1/reports')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(listReportsResponse.status).toBe(200);
        expect(listReportsResponse.body.length).toBe(1);
        expect(listReportsResponse.body[0].number).toBe('200');
        expect(listReportsResponse.body[0].reportType).toBe('add');
    });
});
