import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import * as bcrypt from 'bcrypt';

describe('Password Recovery (e2e)', () => {
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

    it('should trigger forgot-password for Wilson', async () => {
        // Arrange
        const tenant = await prisma.multitenancy.create({
            data: {
                name: 'Test Congregation',
            },
        });

        const email = 'wfelipe2011@gmail.com';
        const name = 'Wilson';
        const password = 'oldpassword123';
        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.user.create({
            data: {
                name: name,
                email: email,
                password: hashedPassword,
                tenantId: tenant.id,
            },
        });

        // Act
        const response = await request(app.getHttpServer())
            .post('/v1/forgot-password')
            .send({
                email: email,
            });

        // Assert
        expect(response.status).toBe(201);
        expect(response.body.message).toBe('Email enviado');
    });

    it('should reset password for Wilson', async () => {
        // Arrange
        const tenant = await prisma.multitenancy.create({
            data: {
                name: 'Test Congregation',
            },
        });

        const email = 'wfelipe2011@gmail.com';
        const name = 'Wilson';
        const oldPassword = 'oldpassword123';
        const newPassword = 'newpassword456';
        const hashedPassword = await bcrypt.hash(oldPassword, 10);

        await prisma.user.create({
            data: {
                name: name,
                email: email,
                password: hashedPassword,
                tenantId: tenant.id,
            },
        });

        // 1. Request forgot password to get the token (we'll mock the email or just generate a token manually for the test)
        // Since we want to test the integration, let's generate a valid token manually that matches the service logic
        const jwt = require('jsonwebtoken');
        const { envs } = require('../src/infra/envs');
        const token = jwt.sign(
            {
                email: email,
                purpose: 'password-recovery',
            },
            envs.JWT_SECRET,
            {
                expiresIn: '30m',
            }
        );

        // Act
        const response = await request(app.getHttpServer())
            .post('/v1/reset-password')
            .send({
                token: token,
                password: newPassword,
            });

        // Assert
        expect(response.status).toBe(201);
        expect(response.body.message).toBe('Senha alterada com sucesso');

        // Verify login with new password
        const loginResponse = await request(app.getHttpServer())
            .post('/v1/login')
            .send({
                email: email,
                password: newPassword,
            });

        expect(loginResponse.status).toBe(201);
        expect(loginResponse.body).toHaveProperty('token');
    });
});

