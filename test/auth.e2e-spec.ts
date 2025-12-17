import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import * as bcrypt from 'bcrypt';
import { Role } from '../src/enum/role.enum';

describe('AuthController (e2e)', () => {
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

    describe('/v1/login (POST)', () => {
        it('should login successfully with valid credentials', async () => {
            // Arrange
            const tenant = await prisma.multitenancy.create({
                data: {
                    name: 'Test Congregation',
                },
            });

            const password = 'password123';
            const hashedPassword = await bcrypt.hash(password, 10);
            const user = await prisma.user.create({
                data: {
                    name: 'Test User',
                    email: 'test@example.com',
                    password: hashedPassword,
                    tenantId: tenant.id,
                },
            });

            // Act
            const response = await request(app.getHttpServer())
                .post('/v1/login')
                .send({
                    email: user.email,
                    password: password,
                });

            // Assert
            expect(response.status).toBe(201); // NestJS default for POST is 201
            expect(response.body).toHaveProperty('token');
        });

        it('should return 401 with invalid password', async () => {
            // Arrange
            const tenant = await prisma.multitenancy.create({
                data: {
                    name: 'Test Congregation',
                },
            });

            const hashedPassword = await bcrypt.hash('password123', 10);
            const user = await prisma.user.create({
                data: {
                    name: 'Test User',
                    email: 'test@example.com',
                    password: hashedPassword,
                    tenantId: tenant.id,
                },
            });

            // Act
            const response = await request(app.getHttpServer())
                .post('/v1/login')
                .send({
                    email: user.email,
                    password: 'wrongpassword',
                });

            // Assert
            expect(response.status).toBe(401);
            expect(response.body.message).toBe('Não autorizado');
        });

        it('should return 401 with non-existent user', async () => {
            // Act
            const response = await request(app.getHttpServer())
                .post('/v1/login')
                .send({
                    email: 'nonexistent@example.com',
                    password: 'password123',
                });

            // Assert
            expect(response.status).toBe(401);
            expect(response.body.message).toBe('Não autorizado');
        });
    });

    describe('Route Protection & Roles', () => {
        it('should return 401 when accessing a protected route without token', async () => {
            const response = await request(app.getHttpServer()).get('/v1/territories');
            expect(response.status).toBe(401);
        });

        it('should return 403 when user does not have required role', async () => {
            // Arrange
            const token = createTestToken({ roles: [Role.PUBLICADOR] });

            // Act
            const response = await request(app.getHttpServer())
                .get('/v1/territories/1/addresses')
                .set('Authorization', `Bearer ${token}`);

            // Assert
            expect(response.status).toBe(403);
            expect(response.body.message).toBe('Acesso não permitido');
        });

        it('should allow access when user has required role', async () => {
            // Arrange
            const token = createTestToken({ roles: [Role.ADMIN] });

            // Act
            const response = await request(app.getHttpServer())
                .get('/v1/territories/1/addresses')
                .set('Authorization', `Bearer ${token}`);

            // Assert
            // We expect 200 or 404 (if territory doesn't exist), but NOT 401 or 403
            expect([200, 404]).toContain(response.status);
        });
    });
});
