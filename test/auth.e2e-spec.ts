import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import * as bcrypt from 'bcryptjs';
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

    describe('/v1/auth/admin/register (POST)', () => {
        it('should register a new admin successfully', async () => {
            // Arrange
            const tenant = await prisma.multitenancy.create({
                data: { name: 'Test Congregation' },
            });
            const adminToken = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

            const payload = {
                name: 'New Admin',
                email: 'wfelipe2011@gmail.com',
            };

            // Act
            const response = await request(app.getHttpServer())
                .post('/v1/auth/admin/register')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(payload);

            // Assert
            expect(response.status).toBe(201);
            expect(response.body.message).toBe('Administrador registrado com sucesso');

            const user = await prisma.user.findUnique({ where: { email: payload.email } });
            expect(user).toBeDefined();
            expect(user?.name).toBe(payload.name);
            expect(user?.tenantId).toBe(tenant.id);
        });

        it('should return 403 if user is not an admin', async () => {
            const token = createTestToken({ roles: [Role.PUBLICADOR] });
            const payload = { name: 'New Admin', email: 'wfelipe2011@gmail.com' };

            const response = await request(app.getHttpServer())
                .post('/v1/auth/admin/register')
                .set('Authorization', `Bearer ${token}`)
                .send(payload);

            expect(response.status).toBe(403);
        });

        it('should return 400 if email is already in use', async () => {
            // Arrange
            const tenant = await prisma.multitenancy.create({
                data: { name: 'Test Congregation' },
            });
            await prisma.user.create({
                data: {
                    name: 'Existing User',
                    email: 'existing@example.com',
                    password: 'hashedpassword',
                    tenantId: tenant.id,
                },
            });
            const adminToken = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

            const payload = {
                name: 'New Admin',
                email: 'existing@example.com',
            };

            // Act
            const response = await request(app.getHttpServer())
                .post('/v1/auth/admin/register')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(payload);

            // Assert
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Email já está em uso');
        });
    });

    describe('/v1/auth/admin/users (GET)', () => {
        it('should list users for the admin tenant', async () => {
            // Arrange
            const tenant = await prisma.multitenancy.create({
                data: { name: 'Test Congregation' },
            });
            await prisma.user.createMany({
                data: [
                    { name: 'User 1', email: 'user1@example.com', password: 'hash', tenantId: tenant.id },
                    { name: 'User 2', email: 'user2@example.com', password: 'hash', tenantId: tenant.id },
                ],
            });
            const adminToken = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

            // Act
            const response = await request(app.getHttpServer())
                .get('/v1/auth/admin/users')
                .set('Authorization', `Bearer ${adminToken}`);

            // Assert
            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(2);
            expect(response.body[0]).toHaveProperty('name');
            expect(response.body[0]).toHaveProperty('email');
            expect(response.body[0]).not.toHaveProperty('password');
        });

        it('should return 403 if user is not an admin', async () => {
            const token = createTestToken({ roles: [Role.PUBLICADOR] });

            const response = await request(app.getHttpServer())
                .get('/v1/auth/admin/users')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(403);
        });
    });

    describe('/v1/auth/public/register (POST)', () => {
        it('should register a new user and tenant successfully', async () => {
            const payload = {
                userName: 'Public User',
                userEmail: 'wfelipe2011@gmail.com',
                tenantName: 'New Congregation',
                tenantPhone: '11999999999',
            };

            const response = await request(app.getHttpServer())
                .post('/v1/auth/public/register')
                .send(payload);

            expect(response.status).toBe(201);
            expect(response.body.message).toBe('Usuário e organização registrados com sucesso');

            const tenant = await prisma.multitenancy.findFirst({ where: { name: payload.tenantName } });
            expect(tenant).toBeDefined();

            const user = await prisma.user.findUnique({ where: { email: payload.userEmail } });
            expect(user).toBeDefined();
            expect(user?.tenantId).toBe(tenant?.id);

            // Check if default parameters were created
            const parameters = await prisma.parameter.findMany({
                where: { tenantId: tenant?.id },
            });
            expect(parameters.length).toBeGreaterThan(0);
            expect(parameters.find(p => p.key === 'SIGNATURE_EXPIRATION_HOURS')?.value).toBe('5');
        });

        it('should return 400 if email is already in use', async () => {
            // Arrange
            const tenant = await prisma.multitenancy.create({
                data: { name: 'Test Congregation' },
            });
            await prisma.user.create({
                data: {
                    name: 'Existing User',
                    email: 'existing@example.com',
                    password: 'hashedpassword',
                    tenantId: tenant.id,
                },
            });

            const payload = {
                userName: 'Public User',
                userEmail: 'existing@example.com',
                tenantName: 'New Congregation',
            };

            // Act
            const response = await request(app.getHttpServer())
                .post('/v1/auth/public/register')
                .send(payload);

            // Assert
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Email já está em uso');
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
