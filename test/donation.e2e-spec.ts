import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';

describe('DonationController (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    const API_KEY = 'test-api-key-secret';

    beforeAll(async () => {
        // Define a API Key para os testes
        process.env.API_KEY_SECRET = API_KEY;
        app = await createTestApp();
        prisma = app.get(PrismaService);
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        await cleanDatabase(prisma);
    });

    describe('POST /v1/donations', () => {
        it('deve criar um donativo com sucesso usando dados do PayPal', async () => {
            // Arrange
            // Garantir que o tenant com ID 1 existe
            await prisma.multitenancy.upsert({
                where: { id: 1 },
                update: {},
                create: {
                    id: 1,
                    name: 'Test Congregation',
                },
            });

            const donationData = {
                customer_name: 'João Silva',
                customer_email: 'joao@example.com',
                payment_date: '31/01/2026 08:15:54 GMT-03:00',
                price: 'R$100,00',
            };

            // Act
            const response = await request(app.getHttpServer())
                .post('/v1/donations')
                .set('x-api-key', API_KEY)
                .send(donationData);

            // Assert
            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('id');
            expect(response.body.tenantId).toBe(1);
            expect(response.body.value).toBe(100.00);
            expect(response.body.donorName).toBe('João Silva');
            expect(response.body.description).toBe('joao@example.com');
            expect(response.body.type).toBe('POSITIVE');
            expect(response.body.externalId).toContain('paypal_joao@example.com');

            // Verificar no banco
            const entry = await prisma.financial_entry.findUnique({
                where: { id: response.body.id },
            });
            expect(entry).toBeTruthy();
            expect(entry?.value).toBe(100.00);
        });

        it('deve rejeitar requisição sem API Key', async () => {
            // Arrange
            const donationData = {
                customer_name: 'João Silva',
                customer_email: 'joao@example.com',
                payment_date: '31/01/2026 08:15:54 GMT-03:00',
                price: 'R$100,00',
            };

            // Act
            const response = await request(app.getHttpServer())
                .post('/v1/donations')
                .send(donationData);

            // Assert
            expect(response.status).toBe(401);
            expect(response.body.message).toContain('API Key não fornecida');
        });

        it('deve rejeitar requisição com API Key inválida', async () => {
            // Arrange
            const donationData = {
                customer_name: 'João Silva',
                customer_email: 'joao@example.com',
                payment_date: '31/01/2026 08:15:54 GMT-03:00',
                price: 'R$100,00',
            };

            // Act
            const response = await request(app.getHttpServer())
                .post('/v1/donations')
                .set('x-api-key', 'wrong-api-key')
                .send(donationData);

            // Assert
            expect(response.status).toBe(401);
            expect(response.body.message).toContain('API Key inválida');
        });

        it('deve parsear corretamente valores em formato brasileiro', async () => {
            // Arrange
            // Garantir que o tenant com ID 1 existe
            await prisma.multitenancy.upsert({
                where: { id: 1 },
                update: {},
                create: {
                    id: 1,
                    name: 'Test Congregation',
                },
            });

            const testCases = [
                { price: 'R$1.234,56', expected: 1234.56 },
                { price: 'R$50,00', expected: 50.0 },
                { price: 'R$9,99', expected: 9.99 },
                { price: '125,75', expected: 125.75 },
            ];

            for (let i = 0; i < testCases.length; i++) {
                const testCase = testCases[i];
                const donationData = {
                    customer_name: 'Test User',
                    customer_email: `test${testCase.expected}_${Date.now()}_${i}@example.com`,
                    payment_date: `31/01/2026 08:15:${54 + i}`,
                    price: testCase.price,
                };

                // Act
                const response = await request(app.getHttpServer())
                    .post('/v1/donations')
                    .set('x-api-key', API_KEY)
                    .send(donationData);

                // Assert
                expect(response.status).toBe(201);
                expect(response.body.value).toBe(testCase.expected);
            }
        });

        it('deve parsear múltiplos formatos de data', async () => {
            // Arrange
            // Garantir que o tenant com ID 1 existe
            await prisma.multitenancy.upsert({
                where: { id: 1 },
                update: {},
                create: {
                    id: 1,
                    name: 'Test Congregation',
                },
            });

            const dateFormats = [
                { format: '31/01/2026 08:15:54 GMT-02:00', day: '31' },
                { format: '30/01/2026 08:15:54', day: '30' },
                { format: '29/01/2026', day: '29' },
            ];

            for (let i = 0; i < dateFormats.length; i++) {
                const dateInfo = dateFormats[i];
                const donationData = {
                    customer_name: 'Test User',
                    customer_email: `test_date_${i}_${Date.now()}@example.com`,
                    payment_date: dateInfo.format,
                    price: 'R$10,00',
                };

                // Act
                const response = await request(app.getHttpServer())
                    .post('/v1/donations')
                    .set('x-api-key', API_KEY)
                    .send(donationData);

                // Assert
                expect(response.status).toBe(201);
                expect(response.body).toHaveProperty('date');
            }
        });

        it('deve rejeitar data em formato inválido', async () => {
            // Arrange
            const donationData = {
                customer_name: 'Test User',
                customer_email: 'test@example.com',
                payment_date: 'invalid-date',
                price: 'R$10,00',
            };

            // Act
            const response = await request(app.getHttpServer())
                .post('/v1/donations')
                .set('x-api-key', API_KEY)
                .send(donationData);

            // Assert
            expect(response.status).toBe(400);
            expect(response.body.message).toContain('Data inválida');
        });

        it('deve rejeitar valor em formato inválido', async () => {
            // Arrange
            const donationData = {
                customer_name: 'Test User',
                customer_email: 'test@example.com',
                payment_date: '31/01/2026',
                price: 'invalid-price',
            };

            // Act
            const response = await request(app.getHttpServer())
                .post('/v1/donations')
                .set('x-api-key', API_KEY)
                .send(donationData);

            // Assert
            expect(response.status).toBe(400);
            expect(response.body.message).toContain('Valor inválido');
        });

        it('deve rejeitar campos obrigatórios ausentes', async () => {
            // Arrange
            const incompleteDonation = {
                customer_name: 'Test User',
                // Faltando customer_email, payment_date, price
            };

            // Act
            const response = await request(app.getHttpServer())
                .post('/v1/donations')
                .set('x-api-key', API_KEY)
                .send(incompleteDonation);

            // Assert
            expect(response.status).toBe(400);
        });
    });
});
