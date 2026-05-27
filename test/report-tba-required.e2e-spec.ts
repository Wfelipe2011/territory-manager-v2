import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';

describe('Porta 3 — Criação de Report: territoryBlockAddressId obrigatório (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    beforeAll(async () => {
        app = await createTestApp();
        prisma = app.get<PrismaService>(PrismaService);
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        await cleanDatabase(prisma);
    });

    it('5.5 — POST /reports sem territoryBlockAddressId deve retornar 201 e resolver o vínculo automaticamente', async () => {
        const tenant = await prisma.multitenancy.create({
            data: { name: 'Tenant Report', city: 'Cidade', state: 'UF' },
        });

        const type = await prisma.type.create({
            data: { name: 'Residencial', tenantId: tenant.id },
        });

        const territory = await prisma.territory.create({
            data: { name: 'Território 1', typeId: type.id, tenantId: tenant.id },
        });

        const block = await prisma.block.create({
            data: { name: 'Bloco A', tenantId: tenant.id },
        });

        const address = await prisma.address.create({
            data: { name: 'Rua A', tenantId: tenant.id },
        });

        const token = createTestToken({ tenantId: tenant.id, roles: [Role.PUBLICADOR] });

        const response = await request(app.getHttpServer())
            .post('/v1/reports')
            .set('Authorization', `Bearer ${token}`)
            .send({
                territoryId: territory.id,
                blockId: block.id,
                addressId: address.id,
                // territoryBlockAddressId ausente propositalmente
                number: '100',
                legend: 'Residência',
                observations: 'Teste',
                reportType: 'add',
            });

        expect(response.status).toBe(201);
        expect(response.body.territoryBlockAddressId).toBeDefined();
        expect(typeof response.body.territoryBlockAddressId).toBe('number');
    });

    it('5.6 — POST /reports com territoryBlockAddressId inexistente no tenant deve retornar 404', async () => {
        const tenant = await prisma.multitenancy.create({
            data: { name: 'Tenant Report 2', city: 'Cidade', state: 'UF' },
        });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.PUBLICADOR] });

        const response = await request(app.getHttpServer())
            .post('/v1/reports')
            .set('Authorization', `Bearer ${token}`)
            .send({
                territoryId: 1,
                blockId: 1,
                addressId: 1,
                territoryBlockAddressId: 99999,
                number: '100',
                legend: 'Residência',
                observations: 'Teste',
                reportType: 'add',
            });

        expect(response.status).toBe(404);
    });
});
