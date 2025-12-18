import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';

describe('Dashboard (e2e)', () => {
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

    it('should return dashboard details', async () => {
        // Arrange
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant' } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // Act
        const response = await request(app.getHttpServer())
            .get('/v1/dashboard/territory-details')
            .set('Authorization', `Bearer ${token}`);

        // Assert
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('total');
    });
});
