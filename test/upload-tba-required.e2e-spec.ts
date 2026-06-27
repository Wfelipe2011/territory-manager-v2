import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';
import xlsx from 'node-xlsx';

describe('Upload de Território: mapeamento TBA automático (e2e)', () => {
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

    it('importa ruas diferentes na mesma quadra criando os mapeamentos necessários', async () => {
        const tenant = await prisma.multitenancy.create({
            data: { name: 'Tenant Upload', city: 'Cidade', state: 'UF' },
        });

        const type = await prisma.type.create({
            data: { name: 'Residencial', tenantId: tenant.id },
        });

        const territory = await prisma.territory.create({
            data: { name: 'Território Upload', tenantId: tenant.id, typeId: type.id },
        });

        // Quadra 1 com TBA pré-criado para "Rua Com TBA"
        const blockComTba = await prisma.block.create({ data: { name: 'Quadra 1', tenantId: tenant.id } });
        const addressComTba = await prisma.address.create({ data: { name: 'Rua Com TBA', tenantId: tenant.id } });

        const territoryBlock = await prisma.territory_block.create({
            data: { territoryId: territory.id, blockId: blockComTba.id, tenantId: tenant.id },
        });

        await prisma.territory_block_address.create({
            data: { territoryBlockId: territoryBlock.id, addressId: addressComTba.id, tenantId: tenant.id },
        });

        const adminToken = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // Linha 1: TBA existe.
        // Linha 2: endereço diferente sem TBA deve ser criado pelo upload.
        const data = [
            ['TipoTerritorio', 'Território', 'Quadra', 'Logradouro', 'Numero', 'Legenda', 'Ordem', 'Não Bater'],
            ['Residencial', 'Território Upload', 1, 'Rua Com TBA', '100', 'Casa', 1, 'FALSO'],
            ['Residencial', 'Território Upload', 1, 'Rua Sem TBA', '200', 'Casa', 2, 'FALSO'],
        ];
        const buffer = xlsx.build([{ name: 'Sheet1', data, options: {} }]);

        const response = await request(app.getHttpServer())
            .post('/v1/territories/upload-territory')
            .set('Authorization', `Bearer ${adminToken}`)
            .attach('file', buffer, 'territory.xlsx');

        expect(response.status).toBe(201);
        expect(response.body.totalProcessed).toBe(2);
        expect(response.body.successCount).toBe(2);
        expect(response.body.errorCount).toBe(0);

        const territoryBlockAddresses = await prisma.territory_block_address.findMany({
            where: { territoryBlockId: territoryBlock.id, tenantId: tenant.id },
        });
        expect(territoryBlockAddresses).toHaveLength(2);
    });
});
