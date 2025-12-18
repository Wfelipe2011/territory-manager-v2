import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { createTestApp } from './utils/app-helper';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';
import { cleanDatabase } from './utils/db-cleaner';
import { SignatureService } from '../src/modules/signature/signature.service';
import { SignatureIsValid } from '../src/modules/signature/usecase/SignatureIsValid';

describe('Signature Flow (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let signatureService: SignatureService;

    beforeAll(async () => {
        app = await createTestApp();
        prisma = app.get<PrismaService>(PrismaService);
        signatureService = app.get<SignatureService>(SignatureService);
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        await cleanDatabase(prisma);
    });

    it('should manage territory and block signatures', async () => {
        // Setup: Create tenant, type, territory, block
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

        await prisma.round_info.create({
            data: {
                roundNumber: 1,
                tenantId: tenant.id,
                name: 'Round 1',
                theme: 'default',
            },
        });

        await prisma.territory_block.create({
            data: {
                territoryId: territory.id,
                blockId: block.id,
                tenantId: tenant.id,
            },
        });

        const adminToken = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // 1. Generate Territory Signature (Overseer)
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 7);
        const expirationStr = expirationDate.toISOString().split('T')[0];

        const genTerritoryResponse = await request(app.getHttpServer())
            .post(`/v1/territories/${territory.id}/signature`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                expirationTime: expirationStr,
                overseer: 'John Doe',
                round: 1,
            });

        expect(genTerritoryResponse.status).toBe(201);
        const territorySignatureKey = genTerritoryResponse.body.signature;
        expect(territorySignatureKey).toBeDefined();

        // 2. Get Signature Info (Public)
        const getSignatureResponse = await request(app.getHttpServer())
            .get(`/v1/signature/${territorySignatureKey}`);

        expect(getSignatureResponse.status).toBe(200);
        expect(getSignatureResponse.body.token).toBeDefined();

        // 3. Generate Block Signature (Publisher)
        const genBlockResponse = await request(app.getHttpServer())
            .post(`/v1/territories/${territory.id}/blocks/${block.id}/signature/1`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(genBlockResponse.status).toBe(201);
        const blockSignatureKey = genBlockResponse.body.signature;
        expect(blockSignatureKey).toBeDefined();

        // 4. Delete Block Signature
        const deleteBlockResponse = await request(app.getHttpServer())
            .delete(`/v1/territories/${territory.id}/blocks/${block.id}/signature`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(deleteBlockResponse.status).toBe(200);

        // Verify block signature is gone
        const updatedBlock = await prisma.territory_block.findUnique({
            where: { territoryId_blockId: { territoryId: territory.id, blockId: block.id } },
        });
        expect(updatedBlock?.signatureId).toBeNull();

        // 5. Delete Territory Signature
        const deleteTerritoryResponse = await request(app.getHttpServer())
            .delete(`/v1/territories/${territory.id}/signature`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(deleteTerritoryResponse.status).toBe(200);

        // Verify territory overseer is finished or signature is gone
        const overseer = await prisma.territory_overseer.findFirst({
            where: { territoryId: territory.id, roundNumber: 1 },
        });
        expect(overseer?.signatureId).toBeNull();
    });

    describe('Validation and Error Cases', () => {
        let tenant: any;
        let territory: any;
        let block: any;
        let adminToken: string;

        beforeEach(async () => {
            tenant = await prisma.multitenancy.create({
                data: { name: 'Validation Tenant', city: 'Test City', state: 'TS' },
            });
            const type = await prisma.type.create({
                data: { name: 'Residencial', tenantId: tenant.id },
            });
            territory = await prisma.territory.create({
                data: { name: 'Territory V', typeId: type.id, tenantId: tenant.id },
            });
            block = await prisma.block.create({
                data: { name: 'Block V', tenantId: tenant.id },
            });
            await prisma.territory_block.create({
                data: {
                    territoryId: territory.id,
                    blockId: block.id,
                    tenantId: tenant.id,
                },
            });
            adminToken = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });
        });

        it('should return 400 for invalid territoryId in createSignatureTerritory', async () => {
            const response = await request(app.getHttpServer())
                .post('/v1/territories/abc/signature')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ expirationTime: '2025-01-01', overseer: 'John', round: 1 });
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Território inválido');
        });

        it('should return 400 for missing fields in createSignatureTerritory', async () => {
            const response = await request(app.getHttpServer())
                .post(`/v1/territories/${territory.id}/signature`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ overseer: 'John', round: 1 });
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Tempo de expiração são obrigatório');
        });

        it('should return 400 for invalid round in createSignatureTerritory', async () => {
            const response = await request(app.getHttpServer())
                .post(`/v1/territories/${territory.id}/signature`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ expirationTime: '2025-01-01', overseer: 'John', round: 'abc' });
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Número da rodada inválida');
        });

        it('should return 400 for invalid territoryId in createSignatureTerritoryBlock', async () => {
            const response = await request(app.getHttpServer())
                .post(`/v1/territories/abc/blocks/${block.id}/signature/1`)
                .set('Authorization', `Bearer ${adminToken}`);
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Território inválido');
        });

        it('should return 400 for invalid blockId in createSignatureTerritoryBlock', async () => {
            const response = await request(app.getHttpServer())
                .post(`/v1/territories/${territory.id}/blocks/abc/signature/1`)
                .set('Authorization', `Bearer ${adminToken}`);
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Bloco inválido');
        });

        it('should return 400 for invalid round in createSignatureTerritoryBlock', async () => {
            const response = await request(app.getHttpServer())
                .post(`/v1/territories/${territory.id}/blocks/${block.id}/signature/abc`)
                .set('Authorization', `Bearer ${adminToken}`);
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Número da rodada inválida');
        });

        it('should return 400 for invalid territoryId in deleteSignatureTerritoryBlock', async () => {
            const response = await request(app.getHttpServer())
                .delete(`/v1/territories/abc/blocks/${block.id}/signature`)
                .set('Authorization', `Bearer ${adminToken}`);
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Território inválido');
        });

        it('should return 400 for invalid blockId in deleteSignatureTerritoryBlock', async () => {
            const response = await request(app.getHttpServer())
                .delete(`/v1/territories/${territory.id}/blocks/abc/signature`)
                .set('Authorization', `Bearer ${adminToken}`);
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Bloco inválido');
        });

        it('should return 400 for invalid date format in createSignatureTerritory', async () => {
            const response = await request(app.getHttpServer())
                .post(`/v1/territories/${territory.id}/signature`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ expirationTime: '01-01-2025', overseer: 'John', round: 1 });
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Data inválida');
        });

        it('should return 404 for non-existent block signature in deleteSignatureTerritoryBlock', async () => {
            const response = await request(app.getHttpServer())
                .delete(`/v1/territories/${territory.id}/blocks/${block.id}/signature`)
                .set('Authorization', `Bearer ${adminToken}`);
            expect(response.status).toBe(404);
        });

        it('should return 404 for non-existent territory signature in deleteSignatureTerritory', async () => {
            const response = await request(app.getHttpServer())
                .delete(`/v1/territories/${territory.id}/signature`)
                .set('Authorization', `Bearer ${adminToken}`);
            expect(response.status).toBe(404);
        });

        it('should return 400 if territory signature already exists', async () => {
            const expirationDate = new Date();
            expirationDate.setDate(expirationDate.getDate() + 7);
            const expirationStr = expirationDate.toISOString().split('T')[0];

            // First generation
            await request(app.getHttpServer())
                .post(`/v1/territories/${territory.id}/signature`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ expirationTime: expirationStr, overseer: 'John', round: 1 });

            // Second generation
            const response = await request(app.getHttpServer())
                .post(`/v1/territories/${territory.id}/signature`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ expirationTime: expirationStr, overseer: 'John', round: 1 });

            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Assinatura já gerada');
        });

        it('should return 400 if block signature already exists', async () => {
            // First generation
            await request(app.getHttpServer())
                .post(`/v1/territories/${territory.id}/blocks/${block.id}/signature/1`)
                .set('Authorization', `Bearer ${adminToken}`);

            // Second generation
            const response = await request(app.getHttpServer())
                .post(`/v1/territories/${territory.id}/blocks/${block.id}/signature/1`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Assinatura já gerada');
        });

        it('should return 404 if round info is not found in findTokenById', async () => {
            // Create a signature manually with a round that doesn't exist in round_info
            const uniqueId = 'test-key-no-round';
            const token = createTestToken({ round: 999, tenantId: tenant.id });
            await prisma.signature.create({
                data: { key: uniqueId, token, tenantId: tenant.id },
            });

            const response = await request(app.getHttpServer())
                .get(`/v1/signature/${uniqueId}`);

            expect(response.status).toBe(404);
            expect(response.body.message).toBe('Round não encontrado');
        });

        it('should return 404 if signature is not found in findTokenById', async () => {
            const response = await request(app.getHttpServer())
                .get('/v1/signature/non-existent');
            expect(response.status).toBe(404);
            expect(response.body.message).toBe('Assinatura não encontrada');
        });

        it('should return 404 if territory block is not found in generateTerritoryBlock', async () => {
            const response = await request(app.getHttpServer())
                .post(`/v1/territories/${territory.id}/blocks/9999/signature/1`)
                .set('Authorization', `Bearer ${adminToken}`);
            expect(response.status).toBe(404);
            expect(response.body.message).toBe('Bloco não encontrado');
        });

        it('should delete block signatures when territory signature is deleted', async () => {
            // Setup territory and block with signatures
            const sig = await prisma.signature.create({
                data: { key: 'sig-t', token: 'token-t', tenantId: tenant.id },
            });
            await prisma.territory_overseer.create({
                data: {
                    territoryId: territory.id,
                    overseer: 'John',
                    roundNumber: 1,
                    tenantId: tenant.id,
                    signatureId: sig.id,
                },
            });
            const sigB = await prisma.signature.create({
                data: { key: 'sig-b', token: 'token-b', tenantId: tenant.id },
            });
            await prisma.territory_block.update({
                where: { territoryId_blockId: { territoryId: territory.id, blockId: block.id } },
                data: { signatureId: sigB.id },
            });

            // Delete territory signature
            const response = await request(app.getHttpServer())
                .delete(`/v1/territories/${territory.id}/signature`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(response.status).toBe(200);

            // Verify block signature is also deleted
            const blockSig = await prisma.signature.findUnique({ where: { id: sigB.id } });
            expect(blockSig).toBeNull();
        });

        it('should test deleteSignatureExpired cron method', async () => {
            const expiredDate = new Date();
            expiredDate.setFullYear(expiredDate.getFullYear() - 1);

            await prisma.signature.create({
                data: {
                    key: 'expired-key',
                    token: 'expired-token',
                    tenantId: tenant.id,
                    expirationDate: expiredDate,
                },
            });

            await signatureService.deleteSignatureExpired();

            const sig = await prisma.signature.findUnique({ where: { key: 'expired-key' } });
            expect(sig).toBeNull();
        });

        it('should test SignatureIsValid usecase', async () => {
            const validator = new SignatureIsValid(prisma);

            // 1. Not found
            await expect(validator.execute('non-existent')).rejects.toThrow('Assinatura inválida');

            // 2. No expiration date
            const sigNoExp = await prisma.signature.create({
                data: { key: 'no-exp', token: 'token', tenantId: tenant.id },
            });
            await expect(validator.execute('no-exp')).rejects.toThrow('Assinatura inválida');

            // 3. Expired
            const expiredDate = new Date();
            expiredDate.setFullYear(expiredDate.getFullYear() - 1);
            await prisma.signature.create({
                data: { key: 'expired', token: 'token', tenantId: tenant.id, expirationDate: expiredDate },
            });
            await expect(validator.execute('expired')).rejects.toThrow('Assinatura expirada');

            // 4. Valid
            const validDate = new Date();
            validDate.setFullYear(validDate.getFullYear() + 1);
            await prisma.signature.create({
                data: { key: 'valid', token: 'token', tenantId: tenant.id, expirationDate: validDate },
            });
            await expect(validator.execute('valid')).resolves.not.toThrow();
        });
    });
});
