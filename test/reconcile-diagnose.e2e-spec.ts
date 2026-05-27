import { PrismaClient } from '@prisma/client';
import { cleanDatabase } from './utils/db-cleaner';
import {
    bulkClassifyStaleHouses,
    phaseAutoLink,
} from '../scripts/reconcileHouseAddresses';

describe('reconcileHouseAddresses — diagnóstico e auto-link (e2e)', () => {
    let prisma: PrismaClient;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    beforeEach(async () => {
        await cleanDatabase(prisma);
    });

    async function criarCenarioBase() {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Tenant Reconcile' } });
        const type = await prisma.type.create({ data: { name: 'Tipo Teste', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Território Teste', typeId: type.id, tenantId: tenant.id },
        });
        const block = await prisma.block.create({ data: { name: 'Quadra Teste', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'Rua Alpha', tenantId: tenant.id } });
        const tb = await prisma.territory_block.create({
            data: { blockId: block.id, territoryId: territory.id, tenantId: tenant.id },
        });
        const tba = await prisma.territory_block_address.create({
            data: { territoryBlockId: tb.id, addressId: address.id, tenantId: tenant.id },
        });
        return { tenant, territory, block, address, tb, tba };
    }

    it('classifica house com único candidato TBA como auto_linkable', async () => {
        const { tenant, territory, block, address, tba } = await criarCenarioBase();

        await prisma.house.create({
            data: {
                number: '42',
                addressId: address.id,
                blockId: block.id,
                territoryId: territory.id,
                tenantId: tenant.id,
                territoryBlockAddressId: null,
            },
        });

        const results = await bulkClassifyStaleHouses(prisma, tenant.id);

        expect(results).toHaveLength(1);
        expect(results[0].category).toBe('auto_linkable');
        expect(results[0].tbaId).toBe(tba.id);
    });

    it('classifica house sem territory_block correspondente como orphan dentro da phaseQuarantine', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Tenant NTB' } });
        const type = await prisma.type.create({ data: { name: 'Tipo NTB', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Território NTB', typeId: type.id, tenantId: tenant.id },
        });
        const block = await prisma.block.create({ data: { name: 'Quadra NTB', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'Rua Sem TBA', tenantId: tenant.id } });

        // Não cria territory_block nem territory_block_address para este tenant
        await prisma.house.create({
            data: {
                number: '7',
                addressId: address.id,
                blockId: block.id,
                territoryId: territory.id,
                tenantId: tenant.id,
                territoryBlockAddressId: null,
            },
        });

        // Test using the actual exported quarantine method
        const { phaseQuarantine } = await import('../scripts/reconcileHouseAddresses');
        const count = await phaseQuarantine(prisma, tenant.id);
        expect(count).toBe(1);
    });

    it('classifica address_mismatch na phaseQuarantine quando há TBAs no bloco sem match de address_id', async () => {
        const { tenant, territory, block, address, tb, tba } = await criarCenarioBase();
        const address2 = await prisma.address.create({ data: { name: 'Rua 2', tenantId: tenant.id } });

        // address_mismatch: tb tem o tba da 'Rua Alpha', mas house usa address2 que não tem TBA no bloco
        await prisma.house.create({
            data: {
                number: '1',
                addressId: address2.id,
                blockId: block.id,
                territoryId: territory.id,
                tenantId: tenant.id,
                territoryBlockAddressId: null,
            },
        });

        const { phaseQuarantine } = await import('../scripts/reconcileHouseAddresses');
        const count = await phaseQuarantine(prisma, tenant.id);
        expect(count).toBe(1); // Caught in quarantine logic
    });

    it('auto-link atualiza territory_block_address_id sem deletar ou recriar a house', async () => {
        const { tenant, territory, block, address, tba } = await criarCenarioBase();

        const house = await prisma.house.create({
            data: {
                number: '100',
                addressId: address.id,
                blockId: block.id,
                territoryId: territory.id,
                tenantId: tenant.id,
                territoryBlockAddressId: null,
            },
        });

        const countAntes = await prisma.house.count({ where: { tenantId: tenant.id } });

        await phaseAutoLink(prisma, tenant.id, false, []);

        const countDepois = await prisma.house.count({ where: { tenantId: tenant.id } });
        const houseAtualizada = await prisma.house.findUnique({ where: { id: house.id } });

        expect(countDepois).toBe(countAntes); // nenhuma house foi deletada ou criada
        expect(houseAtualizada).not.toBeNull();
        expect(houseAtualizada!.territoryBlockAddressId).toBe(tba.id);
    });

    it('auto-link é idempotente: segunda execução não encontra mais houses stale', async () => {
        const { tenant, territory, block, address } = await criarCenarioBase();

        await prisma.house.create({
            data: {
                number: '200',
                addressId: address.id,
                blockId: block.id,
                territoryId: territory.id,
                tenantId: tenant.id,
                territoryBlockAddressId: null,
            },
        });

        // Primeira execução vincula a house
        await phaseAutoLink(prisma, tenant.id, false, []);

        const staleAposPrimeiro = await bulkClassifyStaleHouses(prisma, tenant.id);
        expect(staleAposPrimeiro).toHaveLength(0);

        // Captura estado antes da segunda execução
        const houseAntes = await prisma.house.findMany({ where: { tenantId: tenant.id } });

        // Segunda execução não deve alterar nada
        await phaseAutoLink(prisma, tenant.id, false, []);

        const houseDepois = await prisma.house.findMany({ where: { tenantId: tenant.id } });
        expect(houseDepois).toHaveLength(houseAntes.length);
        expect(houseDepois[0].territoryBlockAddressId).toBe(houseAntes[0].territoryBlockAddressId);
    });

    it('house no_territory_block não é alterada pelo auto-link (gate de ambiguidade)', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Tenant Gate' } });
        const type = await prisma.type.create({ data: { name: 'Tipo Gate', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Território Gate', typeId: type.id, tenantId: tenant.id },
        });
        const block = await prisma.block.create({ data: { name: 'Quadra Gate', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'Rua Sem Vínculo', tenantId: tenant.id } });

        // Sem territory_block -> house é no_territory_block e não deve ser alterada
        const house = await prisma.house.create({
            data: {
                number: '999',
                addressId: address.id,
                blockId: block.id,
                territoryId: territory.id,
                tenantId: tenant.id,
                territoryBlockAddressId: null,
            },
        });

        await phaseAutoLink(prisma, tenant.id, false, []);

        const houseApos = await prisma.house.findUnique({ where: { id: house.id } });
        expect(houseApos!.territoryBlockAddressId).toBeNull();
    });
});
