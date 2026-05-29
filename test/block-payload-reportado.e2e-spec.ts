import { INestApplication } from '@nestjs/common';
import { ThemeMode } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';

describe('Fluxo de quadras com payload reportado (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    const payloadCadastro = {
        name: 'Quadra B',
        addresses: [
            {
                street: 'Av Gerson Ferrielo',
                zipCode: '',
            },
            {
                street: 'Avenida Principal',
                zipCode: '',
            },
        ],
    };

    const criarPayloadEdicao = (id: number) => ({
        id,
        name: 'Quadra A',
        addresses: [
            {
                street: 'Avenida Principal',
                zipCode: '',
            },
        ],
    });

    const criarContextoBase = async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Tenant Payload Reportado' } });
        const type = await prisma.type.create({ data: { name: 'Tipo Payload Reportado', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: {
                name: 'Territorio Payload Reportado',
                typeId: type.id,
                tenantId: tenant.id,
            },
        });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        return { tenant, territory, token };
    };

    const buscarTbasDaQuadra = async (territoryId: number, blockId: number, tenantId: number) => {
        const territoryBlock = await prisma.territory_block.findFirst({
            where: {
                territoryId,
                blockId,
                tenantId,
            },
            include: {
                territory_block_address: {
                    include: {
                        address: true,
                    },
                },
            },
        });

        return territoryBlock?.territory_block_address ?? [];
    };

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

    it('deve cadastrar nova quadra com ruas e zipCode vazio usando o payload informado', async () => {
        const { tenant, territory, token } = await criarContextoBase();

        const response = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send(payloadCadastro);

        expect(response.status).toBe(201);
        expect(response.body.name).toBe('Quadra B');
        expect(response.body.addresses).toHaveLength(2);
        expect(response.body.addresses.map((a: any) => a.street).sort()).toEqual(['Av Gerson Ferrielo', 'Avenida Principal'].sort());
        expect(response.body.addresses.every((a: any) => a.zipCode === '')).toBeTruthy();

        const tbas = await buscarTbasDaQuadra(territory.id, response.body.id, tenant.id);
        expect(tbas).toHaveLength(2);
        expect(tbas.map((tba: any) => tba.address.name).sort()).toEqual(['Av Gerson Ferrielo', 'Avenida Principal'].sort());
    });

    it('deve editar quadra recem-cadastrada com zipCode vazio usando o payload informado', async () => {
        const { tenant, territory, token } = await criarContextoBase();

        const createResponse = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send(payloadCadastro);

        expect(createResponse.status).toBe(201);
        const blockId = createResponse.body.id;

        const response = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send(criarPayloadEdicao(blockId));

        expect(response.status).toBe(201);
        expect(response.body.id).toBe(blockId);
        expect(response.body.name).toBe('Quadra A');
        expect(response.body.addresses).toHaveLength(1);
        expect(response.body.addresses[0].street).toBe('Avenida Principal');
        expect(response.body.addresses[0].zipCode).toBe('');

        const tbas = await buscarTbasDaQuadra(territory.id, blockId, tenant.id);
        expect(tbas).toHaveLength(1);
        expect(tbas[0].address.name).toBe('Avenida Principal');
    });

    it('deve editar quadra com id 778 quando o bloco ja existe no tenant', async () => {
        const { tenant, territory, token } = await criarContextoBase();

        await prisma.$executeRaw`
            INSERT INTO "block" ("id", "name", "tenant_id")
            VALUES (${778}, ${'Quadra Inicial 778'}, ${tenant.id})
        `;

        const response = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send(criarPayloadEdicao(778));

        expect(response.status).toBe(201);
        expect(response.body.id).toBe(778);
        expect(response.body.name).toBe('Quadra A');
        expect(response.body.addresses).toHaveLength(1);
        expect(response.body.addresses[0].street).toBe('Avenida Principal');

        const tbas = await buscarTbasDaQuadra(territory.id, 778, tenant.id);
        expect(tbas).toHaveLength(1);
        expect(tbas[0].address.name).toBe('Avenida Principal');
    });

    it('deve cadastrar quadra sem erro 500 quando round_info inicial ja existe no tenant', async () => {
        const { tenant, territory, token } = await criarContextoBase();

        await prisma.round_info.create({
            data: {
                roundNumber: 1,
                name: 'Inicial',
                theme: ThemeMode.default,
                tenantId: tenant.id,
            },
        });

        const response = await request(app.getHttpServer())
            .post(`/v2/territories/${territory.id}/blocks`)
            .set('Authorization', `Bearer ${token}`)
            .send(payloadCadastro);

        expect(response.status).toBe(201);
        const tbas = await buscarTbasDaQuadra(territory.id, response.body.id, tenant.id);
        expect(tbas).toHaveLength(2);
    });
});
