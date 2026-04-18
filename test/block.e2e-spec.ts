import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';

describe('Block Flow (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    beforeAll(async () => {
        app = await createTestApp();
        prisma = app.get(PrismaService);
        await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        await cleanDatabase(prisma);
    });

    it('should create, update, list and delete blocks', async () => {
        // Arrange
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: {
                name: 'Territory 1',
                typeId: type.id,
                tenantId: tenant.id,
            },
        });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // 1. Create (Upsert)
        const createResponse = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Block A',
                addresses: [
                    { street: 'Rua das Flores', zipCode: '12345678' },
                    { street: 'Avenida Brasil', zipCode: '87654321' }
                ]
            });

        expect(createResponse.status).toBe(201);
        expect(createResponse.body.name).toBe('Block A');
        expect(createResponse.body.addresses).toHaveLength(2);
        const blockId = createResponse.body.id;
        const street1Id = createResponse.body.addresses.find((a: any) => a.street === 'Rua das Flores').id;

        // 2. List blocks for territory
        const listResponse = await request(app.getHttpServer())
            .get(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`);

        expect(listResponse.status).toBe(200);
        expect(listResponse.body).toBeInstanceOf(Array);
        expect(listResponse.body.some((b: any) => b.id === blockId)).toBeTruthy();

        // 3. Get block details
        const detailsResponse = await request(app.getHttpServer())
            .get(`/v2/territories/${territory.id}/blocks/${blockId}`)
            .set('Authorization', `Bearer ${token}`);

        expect(detailsResponse.status).toBe(200);
        expect(detailsResponse.body.id).toBe(blockId);
        expect(detailsResponse.body.name).toBe('Block A');

        // 4. Update (Upsert)
        const updateResponse = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                id: blockId,
                name: 'Block A Updated',
                addresses: [
                    { id: street1Id, street: 'Rua das Flores', zipCode: '12345678' },
                    { street: 'Praça da Sé', zipCode: '00000000' }
                ]
            });

        expect(updateResponse.status).toBe(201);
        expect(updateResponse.body.name).toBe('Block A Updated');
        expect(updateResponse.body.addresses).toHaveLength(2);
        expect(updateResponse.body.addresses.some((a: any) => a.street === 'Praça da Sé')).toBeTruthy();

        // 5. Delete block
        const deleteResponse = await request(app.getHttpServer())
            .delete(`/v2/territories/${territory.id}/blocks/${blockId}`)
            .set('Authorization', `Bearer ${token}`);

        expect(deleteResponse.status).toBe(200);

        // Verify deletion
        const listAfterDelete = await request(app.getHttpServer())
            .get(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`);
        expect(listAfterDelete.body.some((b: any) => b.id === blockId)).toBeFalsy();
    });

    it('should handle block with no addresses', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: {
                name: 'Territory 1',
                typeId: type.id,
                tenantId: tenant.id,
            },
        });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // Create block with no addresses
        const response = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Block No Address',
                addresses: []
            });

        expect(response.status).toBe(201);
        expect(response.body.addresses).toHaveLength(0);

        const blockId = response.body.id;

        // Update to add an address
        const updateResponse = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                id: blockId,
                name: 'Block Now Has Address',
                addresses: [{ street: 'New Street' }]
            });

        expect(updateResponse.status).toBe(201);
        expect(updateResponse.body.addresses).toHaveLength(1);

        // Update to remove all addresses
        const removeResponse = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                id: blockId,
                name: 'Block No Address Again',
                addresses: []
            });

        expect(removeResponse.status).toBe(201);
        expect(removeResponse.body.addresses).toHaveLength(0);
    });

    it('should reuse identical addresses, create new ones for different names, and support case-insensitive and trim normalization', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: {
                name: 'Territory 1',
                typeId: type.id,
                tenantId: tenant.id,
            },
        });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // 1. Create first block with an exact address
        const response1 = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Block 1',
                addresses: [{ street: 'Avenida Paulista' }]
            });

        const paulistaAddressId = response1.body.addresses[0].id;

        // 2. Reuse the exact same address name
        const response2 = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Block 2',
                addresses: [{ street: 'Avenida Paulista' }]
            });

        expect(response2.body.addresses[0].id).toBe(paulistaAddressId);

        // 3. Use a different address name and expect a new address to be created
        const response3 = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Block 3',
                addresses: [{ street: 'Av. Paulista' }]
            });

        expect(response3.body.addresses[0].id).not.toBe(paulistaAddressId);

        // 4. Create a new block with a case-insensitive variant of a previously created street
        const response4 = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Block 4',
                addresses: [{ street: 'rua das flores' }]
            });

        const ruaDasFloresAddressId = response4.body.addresses[0].id;
        expect(ruaDasFloresAddressId).toBeDefined();

        const response5 = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Block 5',
                addresses: [{ street: 'Rua das Flores' }]
            });

        expect(response5.body.addresses[0].id).toBe(ruaDasFloresAddressId);

        // 5. Normalize input with trim and reuse the same address
        const response6 = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Block 6',
                addresses: [{ street: '  Rua das Flores  ' }]
            });

        expect(response6.body.addresses[0].id).toBe(ruaDasFloresAddressId);
    });

    it('should return 404 when deleting non-existent block', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant' } });
        const type = await prisma.type.create({ data: { name: 'Type 1', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: {
                name: 'Territory 1',
                typeId: type.id,
                tenantId: tenant.id,
            },
        });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        const response = await request(app.getHttpServer())
            .delete(`/v2/territories/${territory.id}/blocks/999`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(404);
    });

    it('should return 403 when user is not ADMIN', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant' } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.PUBLICADOR] });

        const response = await request(app.getHttpServer())
            .get(`/v2/territories/1/blocks`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(403);
    });
});
