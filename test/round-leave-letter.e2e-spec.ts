import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';
import dayjs from 'dayjs';

describe('Round leaveLetter (e2e)', () => {
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

    async function criarEstrutura(nomeTenant: string) {
        const tenant = await prisma.multitenancy.create({ data: { name: nomeTenant } });
        const type = await prisma.type.create({ data: { name: 'Tipo', tenantId: tenant.id } });
        const territory = await prisma.territory.create({ data: { name: 'Território', tenantId: tenant.id, typeId: type.id } });
        const block = await prisma.block.create({ data: { name: 'Quadra', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'Rua', tenantId: tenant.id } });
        const tb = await prisma.territory_block.create({ data: { blockId: block.id, territoryId: territory.id, tenantId: tenant.id } });
        const tba = await prisma.territory_block_address.create({ data: { territoryBlockId: tb.id, addressId: address.id, tenantId: tenant.id } });
        const house = await prisma.house.create({
            data: { number: '1', blockId: block.id, addressId: address.id, territoryId: territory.id, tenantId: tenant.id, territoryBlockAddressId: tba.id },
        });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });
        return { tenant, type, territory, block, address, tba, house, token };
    }

    it('novo tenant sem histórico: leaveLetter deve ser false para todas as casas', async () => {
        const { tenant, type, token } = await criarEstrutura('Tenant Novo');

        const res = await request(app.getHttpServer())
            .post('/v1/rounds/start')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Primeira Rodada', typeId: type.id, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' });

        expect(res.status).toBe(201);

        const rounds = await prisma.round.findMany({ where: { tenantId: tenant.id } });
        expect(rounds.length).toBeGreaterThan(0);
        expect(rounds.every(r => r.leaveLetter === false)).toBe(true);
    });

    it('casa não visitada dentro da janela: leaveLetter deve ser true', async () => {
        const { tenant, type, territory, block, house, token } = await criarEstrutura('Tenant Não Visitado');

        // Criar rodada anterior (dentro da janela de 6 meses) com casa NÃO completada
        await prisma.round_info.create({
            data: { roundNumber: 1, name: 'Rodada Anterior', tenantId: tenant.id, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' },
        });
        await prisma.round.create({
            data: {
                roundNumber: 1,
                tenantId: tenant.id,
                territoryId: territory.id,
                blockId: block.id,
                houseId: house.id,
                completed: false,
                startDate: dayjs().subtract(2, 'months').toDate(),
                endDate: dayjs().subtract(1, 'months').toDate(),
            },
        });

        const res = await request(app.getHttpServer())
            .post('/v1/rounds/start')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Nova Rodada', typeId: type.id, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' });

        expect(res.status).toBe(201);

        const novaRodada = await prisma.round.findFirst({ where: { tenantId: tenant.id, roundNumber: 2 } });
        expect(novaRodada?.leaveLetter).toBe(true);
    });

    it('casa visitada dentro da janela: leaveLetter deve ser false', async () => {
        const { tenant, type, territory, block, house, token } = await criarEstrutura('Tenant Visitado');

        // Criar rodada anterior (dentro da janela de 6 meses) com casa completada
        await prisma.round_info.create({
            data: { roundNumber: 1, name: 'Rodada Anterior', tenantId: tenant.id, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' },
        });
        await prisma.round.create({
            data: {
                roundNumber: 1,
                tenantId: tenant.id,
                territoryId: territory.id,
                blockId: block.id,
                houseId: house.id,
                completed: true,
                startDate: dayjs().subtract(2, 'months').toDate(),
                endDate: dayjs().subtract(1, 'months').toDate(),
            },
        });

        const res = await request(app.getHttpServer())
            .post('/v1/rounds/start')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Nova Rodada', typeId: type.id, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' });

        expect(res.status).toBe(201);

        const novaRodada = await prisma.round.findFirst({ where: { tenantId: tenant.id, roundNumber: 2 } });
        expect(novaRodada?.leaveLetter).toBe(false);
    });

    it('rodada anterior fora da janela configurada: leaveLetter deve ser false', async () => {
        const { tenant, type, territory, block, house, token } = await criarEstrutura('Tenant Fora Janela');

        // Configurar janela de 1 mês para este tenant
        await prisma.parameter.create({
            data: { key: 'ROUND_START_DATE_MONTHS', value: '1', description: 'Teste', tenantId: tenant.id },
        });

        // Criar rodada anterior FORA da janela (2 meses atrás, janela é 1 mês)
        await prisma.round_info.create({
            data: { roundNumber: 1, name: 'Rodada Antiga', tenantId: tenant.id, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' },
        });
        await prisma.round.create({
            data: {
                roundNumber: 1,
                tenantId: tenant.id,
                territoryId: territory.id,
                blockId: block.id,
                houseId: house.id,
                completed: false,
                startDate: dayjs().subtract(2, 'months').toDate(),
                endDate: dayjs().subtract(2, 'months').add(1, 'week').toDate(),
            },
        });

        const res = await request(app.getHttpServer())
            .post('/v1/rounds/start')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Nova Rodada', typeId: type.id, theme: 'default', colorPrimary: '#000', colorSecondary: '#fff' });

        expect(res.status).toBe(201);

        const novaRodada = await prisma.round.findFirst({ where: { tenantId: tenant.id, roundNumber: 2 } });
        // Fora da janela = sem histórico relevante = leaveLetter false
        expect(novaRodada?.leaveLetter).toBe(false);
    });
});
