import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { createTestApp } from './utils/app-helper';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';
import { cleanDatabase } from './utils/db-cleaner';
import xlsx from 'node-xlsx';

describe('Upload Flow (e2e)', () => {
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

    it('should upload territory from excel', async () => {
        const tenant = await prisma.multitenancy.create({
            data: { name: 'Test Tenant', city: 'Test City', state: 'TS' },
        });

        const adminToken = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // Create Excel buffer
        const data = [
            ['TipoTerritorio', 'Território', 'Quadra', 'Logradouro', 'Numero', 'Legenda', 'Ordem', 'Não Bater'],
            ['Residencial', 'Territory 1', 1, 'Street A', '100', 'Blue House', 1, 'FALSO'],
            ['Residencial', 'Territory 1', 1, 'Street A', '101', 'Red House', 2, 'VERDADEIRO'],
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

        // Verify database
        const territories = await prisma.territory.findMany({ where: { tenantId: tenant.id } });
        expect(territories.length).toBe(1);
        expect(territories[0].name).toBe('Territory 1');

        const houses = await prisma.house.findMany({ where: { tenantId: tenant.id } });
        expect(houses.length).toBe(2);
        expect(houses.find(h => h.number === '100')?.dontVisit).toBe(false);
        expect(houses.find(h => h.number === '101')?.dontVisit).toBe(true);
    });
});
