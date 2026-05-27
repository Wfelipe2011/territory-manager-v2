import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';

describe('Porta 1 — Criação de House: territoryBlockAddressId obrigatório (e2e)', () => {
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

    it('5.2 — POST /houses sem mapeamento territory_block_address deve retornar 400', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Tenant 1' } });
        const type = await prisma.type.create({ data: { name: 'Residencial', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Território A', tenantId: tenant.id, typeId: type.id },
        });
        const block = await prisma.block.create({ data: { name: 'Quadra 1', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'Rua Sem TBA', tenantId: tenant.id } });
        // territory_block_address intencionalmente ausente

        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        const response = await request(app.getHttpServer())
            .post('/v1/houses')
            .set('Authorization', `Bearer ${token}`)
            .send({
                streetId: address.id,
                number: '100',
                legend: '',
                dontVisit: false,
                territoryId: territory.id,
                blockId: block.id,
            });

        expect(response.status).toBe(400);
    });

    it('5.3 — POST /houses com territoryBlockAddressId válido deve retornar 201 com campo preenchido', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Tenant 2' } });
        const type = await prisma.type.create({ data: { name: 'Residencial', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Território A', tenantId: tenant.id, typeId: type.id },
        });
        const block = await prisma.block.create({ data: { name: 'Quadra 1', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'Rua A', tenantId: tenant.id } });

        const territoryBlock = await prisma.territory_block.create({
            data: { territoryId: territory.id, blockId: block.id, tenantId: tenant.id },
        });

        const tba = await prisma.territory_block_address.create({
            data: { territoryBlockId: territoryBlock.id, addressId: address.id, tenantId: tenant.id },
        });

        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        const response = await request(app.getHttpServer())
            .post('/v1/houses')
            .set('Authorization', `Bearer ${token}`)
            .send({
                streetId: address.id,
                number: '100',
                legend: '',
                dontVisit: false,
                territoryId: territory.id,
                blockId: block.id,
                territoryBlockAddressId: tba.id,
            });

        expect(response.status).toBe(201);
        expect(response.body.territoryBlockAddressId).toBe(tba.id);
    });
});
