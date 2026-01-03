import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';

describe('House Flow (e2e)', () => {
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

    it('should manage houses (list, update status, update details)', async () => {
        // Arrange
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Territory 1', tenantId: tenant.id, typeId: type.id },
        });
        const block = await prisma.block.create({
            data: { name: 'Block 1', tenantId: tenant.id },
        });
        const address = await prisma.address.create({
            data: { name: 'Street 1', tenantId: tenant.id },
        });

        const signature = await prisma.signature.create({
            data: {
                key: 'test-key',
                token: 'test-token',
                tenantId: tenant.id,
            },
        });

        await prisma.territory_block.create({
            data: {
                territoryId: territory.id,
                blockId: block.id,
                tenantId: tenant.id,
                signatureId: signature.id,
            },
        });

        const house = await prisma.house.create({
            data: {
                number: '100',
                blockId: block.id,
                addressId: address.id,
                territoryId: territory.id,
                tenantId: tenant.id,
            },
        });
        const round = await prisma.round.create({
            data: {
                roundNumber: 1,
                territoryId: territory.id,
                blockId: block.id,
                houseId: house.id,
                tenantId: tenant.id,
                completed: false,
            },
        });

        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // 1. List addresses in block
        const listAddressesResponse = await request(app.getHttpServer())
            .get(`/v1/territories/${territory.id}/blocks/${block.id}?round=1`)
            .set('Authorization', `Bearer ${token}`);

        expect(listAddressesResponse.status).toBe(200);

        // 2. List houses in address
        const listHousesResponse = await request(app.getHttpServer())
            .get(`/v1/territories/${territory.id}/blocks/${block.id}/address/${address.id}?round=1`)
            .set('Authorization', `Bearer ${token}`);

        expect(listHousesResponse.status).toBe(200);

        // 3. Update house status (legend/completed)
        const updateStatusResponse = await request(app.getHttpServer())
            .patch(`/v1/territories/${territory.id}/blocks/${block.id}/address/${address.id}/houses/${house.id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                status: true,
                round: 1,
            });

        expect(updateStatusResponse.status).toBe(200);

        // Verify update
        const updatedRound = await prisma.round.findFirst({
            where: { houseId: house.id, roundNumber: 1 },
        });
        expect(updatedRound?.completed).toBe(true);

        // 4. Update house details (ADMIN only)
        const updateDetailsResponse = await request(app.getHttpServer())
            .put(`/v1/houses/${house.id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                number: '101',
                blockId: block.id,
                streetId: address.id,
                territoryId: territory.id,
                dontVisit: true,
                legend: 'Visited',
            });

        expect(updateDetailsResponse.status).toBe(200);

        const updatedHouse = await prisma.house.findUnique({ where: { id: house.id } });
        expect(updatedHouse?.number).toBe('101');
        expect(updatedHouse?.dontVisit).toBe(true);
    });

    it('should find, create, update and delete houses (Admin)', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant Admin' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Territory 1', tenantId: tenant.id, typeId: type.id },
        });
        const block = await prisma.block.create({ data: { name: 'Block 1', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'Street 1', tenantId: tenant.id } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // 1. Create
        const createResponse = await request(app.getHttpServer())
            .post('/v1/houses')
            .set('Authorization', `Bearer ${token}`)
            .send({
                number: '200',
                blockId: block.id,
                streetId: address.id,
                territoryId: territory.id,
                dontVisit: false,
                legend: '',
            });
        expect(createResponse.status).toBe(201);
        const houseId = createResponse.body.id;

        // 2. Find by ID
        const findResponse = await request(app.getHttpServer())
            .get(`/v1/houses/${houseId}`)
            .set('Authorization', `Bearer ${token}`);
        expect(findResponse.status).toBe(200);
        expect(findResponse.body.number).toBe('200');

        // 3. Update Order
        const orderResponse = await request(app.getHttpServer())
            .post('/v1/houses/order')
            .set('Authorization', `Bearer ${token}`)
            .send({
                houses: [{ id: houseId, order: 1 }],
            });
        expect(orderResponse.status).toBe(201);

        // 4. Delete
        const deleteResponse = await request(app.getHttpServer())
            .delete(`/v1/houses/${houseId}`)
            .set('Authorization', `Bearer ${token}`);
        expect(deleteResponse.status).toBe(200);
    });

    it('should enforce permissions for PUBLICADOR', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant Publicador' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Territory 1', tenantId: tenant.id, typeId: type.id },
        });
        const block = await prisma.block.create({
            data: { name: 'Block 1', tenantId: tenant.id },
        });

        // Publicador with NO signature
        const tokenNoSig = createTestToken({
            tenantId: tenant.id,
            roles: [Role.PUBLICADOR],
            userId: 999,
        });

        const responseNoSig = await request(app.getHttpServer())
            .get(`/v1/territories/${territory.id}/blocks/${block.id}?round=1`)
            .set('Authorization', `Bearer ${tokenNoSig}`);

        // Should fail because signature is not found/valid for this user
        // SignatureIsValid throws NotFoundException (404) for "Assinatura inválida"
        expect(responseNoSig.status).toBe(404);
    });

    it('should return 403 for PUBLICADOR accessing unauthorized territory/block', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant Forbidden' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Territory 1', tenantId: tenant.id, typeId: type.id },
        });
        const block = await prisma.block.create({
            data: { name: 'Block 1', tenantId: tenant.id },
        });

        // Create a signature for the user so they pass the signature check
        const signature = await prisma.signature.create({
            data: {
                key: 'valid-key',
                token: 'valid-token',
                tenantId: tenant.id,
                expirationDate: new Date(Date.now() + 100000),
            },
        });

        const token = createTestToken({
            tenantId: tenant.id,
            roles: [Role.PUBLICADOR],
            id: signature.key, // Use signature key as id
            territoryId: 999, // Different territory
            blockId: 999, // Different block
        });

        const response = await request(app.getHttpServer())
            .get(`/v1/territories/${territory.id}/blocks/${block.id}?round=1`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(403);
        expect(response.body.message).toContain('não tem permissão para acessar esse território');
    });

    it('should allow PUBLICADOR with valid signature and authorized access', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant Allowed' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Territory 1', tenantId: tenant.id, typeId: type.id },
        });
        const block = await prisma.block.create({
            data: { name: 'Block 1', tenantId: tenant.id },
        });

        const signature = await prisma.signature.create({
            data: {
                key: 'valid-key-2',
                token: 'valid-token-2',
                tenantId: tenant.id,
                expirationDate: new Date(Date.now() + 100000),
            },
        });

        await prisma.territory_block.create({
            data: {
                territoryId: territory.id,
                blockId: block.id,
                tenantId: tenant.id,
                signatureId: signature.id,
            },
        });

        const address = await prisma.address.create({
            data: { name: 'Street 1', tenantId: tenant.id },
        });

        await prisma.house.create({
            data: {
                number: '100',
                blockId: block.id,
                addressId: address.id,
                territoryId: territory.id,
                tenantId: tenant.id,
            },
        });

        const token = createTestToken({
            tenantId: tenant.id,
            roles: [Role.PUBLICADOR],
            id: signature.key, // Use signature key as id
            territoryId: territory.id,
            blockId: block.id,
        });

        const response = await request(app.getHttpServer())
            .get(`/v1/territories/${territory.id}/blocks/${block.id}?round=1`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
    });

    describe('Validation and Permissions', () => {
        let token: string;
        let territory: any;
        let block: any;

        beforeAll(async () => {
            const tenant = await prisma.multitenancy.create({ data: { name: 'Validation Tenant' } });
            const type = await prisma.type.create({ data: { name: 'Type V', tenantId: tenant.id } });
            territory = await prisma.territory.create({
                data: { name: 'Territory V', tenantId: tenant.id, typeId: type.id },
            });
            block = await prisma.block.create({ data: { name: 'Block V', tenantId: tenant.id } });
            token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });
        });

        it('should return 400 for invalid territoryId in getAddressPerTerritoryByIdAndBlockById', async () => {
            const response = await request(app.getHttpServer())
                .get(`/v1/territories/abc/blocks/${block.id}`)
                .set('Authorization', `Bearer ${token}`);
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Território inválido');
        });

        it('should return 400 for invalid blockId in getAddressPerTerritoryByIdAndBlockById', async () => {
            const response = await request(app.getHttpServer())
                .get(`/v1/territories/${territory.id}/blocks/abc`)
                .set('Authorization', `Bearer ${token}`);
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Bloco inválido');
        });

        it('should return 400 for missing round in getAddressPerTerritoryByIdAndBlockById', async () => {
            const response = await request(app.getHttpServer())
                .get(`/v1/territories/${territory.id}/blocks/${block.id}`)
                .set('Authorization', `Bearer ${token}`);
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Rodada inválida');
        });

        it('should return 400 for not round in getAddressPerTerritoryByIdAndBlockById', async () => {
            const response = await request(app.getHttpServer())
                .get(`/v1/territories/${territory.id}/blocks/${block.id}`)
                .set('Authorization', `Bearer ${token}`);
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Rodada inválida');
        });

        it('should return 400 for invalid addressId in getHousesPerTerritoryByIdAndBlockByIdAndAddressById', async () => {
            const response = await request(app.getHttpServer())
                .get(`/v1/territories/${territory.id}/blocks/${block.id}/address/abc`)
                .set('Authorization', `Bearer ${token}`);
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Endereço inválido');
        });

        it('should return 400 for invalid houseId in updateHouse', async () => {
            const response = await request(app.getHttpServer())
                .patch(`/v1/territories/${territory.id}/blocks/${block.id}/address/1/houses/abc`)
                .set('Authorization', `Bearer ${token}`)
                .send({ status: true, round: 1 });
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Casa inválido');
        });

        it('should return 400 for invalid round in updateHouse', async () => {
            const response = await request(app.getHttpServer())
                .patch(`/v1/territories/${territory.id}/blocks/${block.id}/address/1/houses/1`)
                .set('Authorization', `Bearer ${token}`)
                .send({ status: true, round: 'abc' });
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Rodada inválida');
        });

        it('should return 400 for invalid territoryId in updateHouse', async () => {
            const response = await request(app.getHttpServer())
                .patch(`/v1/territories/abc/blocks/${block.id}/address/1/houses/1`)
                .set('Authorization', `Bearer ${token}`)
                .send({ status: true, round: 1 });
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Território inválido');
        });

        it('should return 400 for invalid blockId in updateHouse', async () => {
            const response = await request(app.getHttpServer())
                .patch(`/v1/territories/${territory.id}/blocks/abc/address/1/houses/1`)
                .set('Authorization', `Bearer ${token}`)
                .send({ status: true, round: 1 });
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Bloco inválido');
        });

        it('should return 400 for invalid addressId in updateHouse', async () => {
            const response = await request(app.getHttpServer())
                .patch(`/v1/territories/${territory.id}/blocks/${block.id}/address/abc/houses/1`)
                .set('Authorization', `Bearer ${token}`)
                .send({ status: true, round: 1 });
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Endereço inválido');
        });

        it('should return 400 for missing round in getHousesPerTerritoryByIdAndBlockByIdAndAddressById', async () => {
            const response = await request(app.getHttpServer())
                .get(`/v1/territories/${territory.id}/blocks/${block.id}/address/1`)
                .set('Authorization', `Bearer ${token}`);
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Rodada inválida');
        });
        it('should return 400 for invalid territoryId in getHousesPerTerritoryByIdAndBlockByIdAndAddressById', async () => {
            const response = await request(app.getHttpServer())
                .get(`/v1/territories/abc/blocks/${block.id}/address/1?round=1`)
                .set('Authorization', `Bearer ${token}`);
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Território inválido');
        });

        it('should return 400 for invalid blockId in getHousesPerTerritoryByIdAndBlockByIdAndAddressById', async () => {
            const response = await request(app.getHttpServer())
                .get(`/v1/territories/${territory.id}/blocks/abc/address/1?round=1`)
                .set('Authorization', `Bearer ${token}`);
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Bloco inválido');
        });
        it('should return 400 for missing round in updateHouse', async () => {
            const response = await request(app.getHttpServer())
                .patch(`/v1/territories/${territory.id}/blocks/${block.id}/address/1/houses/1`)
                .set('Authorization', `Bearer ${token}`)
                .send({ status: true });
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Rodada inválida');
        });

        it('should return 400 for missing status in updateHouse', async () => {
            const response = await request(app.getHttpServer())
                .patch(`/v1/territories/${territory.id}/blocks/${block.id}/address/1/houses/1`)
                .set('Authorization', `Bearer ${token}`)
                .send({ round: 1 });
            expect(response.status).toBe(400);
            expect(response.body.message).toBe('Status são obrigatório');
        });

        it('should return 404 for non-existent house in findById', async () => {
            const response = await request(app.getHttpServer())
                .get('/v1/houses/999999')
                .set('Authorization', `Bearer ${token}`);
            // Depending on service implementation, it might return 404 or null.
            // If it throws NotFoundException, it will hit the catch block.
            expect(response.status).toBe(404);
        });

        it('should return 404 for non-existent house in delete', async () => {
            const response = await request(app.getHttpServer())
                .delete('/v1/houses/999999')
                .set('Authorization', `Bearer ${token}`);
            expect(response.status).toBe(404);
        });

        it('should return 500 for non-existent house in updateOrder', async () => {
            const response = await request(app.getHttpServer())
                .post('/v1/houses/order')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    houses: [{ id: 999999, order: 1 }],
                });
            // Prisma throws error which results in 500 if not handled specifically as 404
            expect(response.status).toBe(500);
        });

        it('should return 404 for non-existent street in create', async () => {
            const response = await request(app.getHttpServer())
                .post('/v1/houses')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    number: '200',
                    blockId: block.id,
                    streetId: 999999,
                    territoryId: territory.id,
                    dontVisit: false,
                    legend: '',
                });
            expect(response.status).toBe(404);
        });

        it('should return 404 for non-existent house in update', async () => {
            const response = await request(app.getHttpServer())
                .put('/v1/houses/999999')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    number: '200',
                    blockId: block.id,
                    streetId: 1,
                    territoryId: territory.id,
                    dontVisit: false,
                    legend: '',
                });
            expect(response.status).toBe(404);
        });
    });
});
