import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';

describe('ParametersController (e2e)', () => {
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

    describe('/v1/parameters (POST)', () => {
        it('should create a parameter for an admin', async () => {
            const tenant = await prisma.multitenancy.create({
                data: { name: 'Test Tenant' },
            });

            const token = createTestToken({
                tenantId: tenant.id,
                roles: [Role.ADMIN],
            });

            const response = await request(app.getHttpServer())
                .post('/v1/parameters')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    key: 'TEST_KEY',
                    value: 'TEST_VALUE',
                    description: 'Test Description',
                });

            expect(response.status).toBe(201);
            expect(response.body.key).toBe('TEST_KEY');
            expect(response.body.value).toBe('TEST_VALUE');

            const paramInDb = await prisma.parameter.findFirst({
                where: { tenantId: tenant.id, key: 'TEST_KEY' },
            });
            expect(paramInDb).toBeDefined();
            expect(paramInDb?.value).toBe('TEST_VALUE');
        });

        it('should not allow a non-admin to create a parameter', async () => {
            const tenant = await prisma.multitenancy.create({
                data: { name: 'Test Tenant' },
            });

            const token = createTestToken({
                tenantId: tenant.id,
                roles: [Role.PUBLICADOR],
            });

            const response = await request(app.getHttpServer())
                .post('/v1/parameters')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    key: 'TEST_KEY',
                    value: 'TEST_VALUE',
                });

            expect(response.status).toBe(403);
        });
    });

    describe('/v1/parameters (GET)', () => {
        it('should list parameters for the tenant', async () => {
            const tenant = await prisma.multitenancy.create({
                data: { name: 'Test Tenant' },
            });

            await prisma.parameter.create({
                data: {
                    key: 'KEY_LIST_1',
                    value: 'VAL_1',
                    tenantId: tenant.id,
                },
            });

            const token = createTestToken({
                tenantId: tenant.id,
                roles: [Role.ADMIN],
            });

            const response = await request(app.getHttpServer())
                .get('/v1/parameters')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(response.body[0].key).toBe('KEY_LIST_1');
        });

        it('should not show parameters from other tenants', async () => {
            const tenant1 = await prisma.multitenancy.create({ data: { name: 'Tenant 1' } });
            const tenant2 = await prisma.multitenancy.create({ data: { name: 'Tenant 2' } });

            await prisma.parameter.create({
                data: { key: 'KEY_OTHER_TENANT', value: 'VAL_T1', tenantId: tenant1.id },
            });

            const token2 = createTestToken({
                tenantId: tenant2.id,
                roles: [Role.ADMIN],
            });

            const response = await request(app.getHttpServer())
                .get('/v1/parameters')
                .set('Authorization', `Bearer ${token2}`);

            expect(response.status).toBe(200);
            const hasOtherTenantKey = response.body.some((p: any) => p.key === 'KEY_OTHER_TENANT');
            expect(hasOtherTenantKey).toBe(false);
        });
    });
});
