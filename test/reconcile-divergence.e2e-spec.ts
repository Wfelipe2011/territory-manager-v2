import { PrismaClient } from '@prisma/client';
import { cleanDatabase } from './utils/db-cleaner';
import {
    detectDivergences,
    phaseFixDivergence,
} from '../scripts/reconcileHouseAddresses';

describe('reconcileHouseAddresses — divergência de address (e2e)', () => {
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

    async function criarHouseDivergente() {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Tenant Divergente' } });
        const type = await prisma.type.create({ data: { name: 'Tipo Div', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Território Div', typeId: type.id, tenantId: tenant.id },
        });
        const block = await prisma.block.create({ data: { name: 'Quadra Div', tenantId: tenant.id } });

        // Dois endereços distintos: um na house (legado), outro no TBA (canônico)
        const addressHouse = await prisma.address.create({ data: { name: 'Rua Antiga', tenantId: tenant.id } });
        const addressTBA = await prisma.address.create({ data: { name: 'Rua Canônica', tenantId: tenant.id } });

        const tb = await prisma.territory_block.create({
            data: { blockId: block.id, territoryId: territory.id, tenantId: tenant.id },
        });
        const tba = await prisma.territory_block_address.create({
            data: { territoryBlockId: tb.id, addressId: addressTBA.id, tenantId: tenant.id },
        });

        // House linkada ao TBA mas com address_id diferente do TBA (divergência)
        const house = await prisma.house.create({
            data: {
                number: '55',
                addressId: addressHouse.id,
                blockId: block.id,
                territoryId: territory.id,
                tenantId: tenant.id,
                territoryBlockAddressId: tba.id,
            },
        });

        return { tenant, house, addressHouse, addressTBA, tba };
    }

    it('detecta house divergente quando house.address_id difere de tba.address_id', async () => {
        const { tenant, house, addressHouse, addressTBA, tba } = await criarHouseDivergente();

        const divergences = await detectDivergences(prisma, tenant.id);

        expect(divergences).toHaveLength(1);
        expect(divergences[0].houseId).toBe(house.id);
        expect(divergences[0].houseAddressId).toBe(addressHouse.id);
        expect(divergences[0].tbaAddressId).toBe(addressTBA.id);
        expect(divergences[0].territoryBlockAddressId).toBe(tba.id);
    });

    it('não reporta divergência quando house.address_id coincide com tba.address_id', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Tenant Consistente' } });
        const type = await prisma.type.create({ data: { name: 'Tipo OK', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Território OK', typeId: type.id, tenantId: tenant.id },
        });
        const block = await prisma.block.create({ data: { name: 'Quadra OK', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'Rua Consistente', tenantId: tenant.id } });

        const tb = await prisma.territory_block.create({
            data: { blockId: block.id, territoryId: territory.id, tenantId: tenant.id },
        });
        const tba = await prisma.territory_block_address.create({
            data: { territoryBlockId: tb.id, addressId: address.id, tenantId: tenant.id },
        });

        // House com MESMO address do TBA — sem divergência
        await prisma.house.create({
            data: {
                number: '33',
                addressId: address.id,
                blockId: block.id,
                territoryId: territory.id,
                tenantId: tenant.id,
                territoryBlockAddressId: tba.id,
            },
        });

        const divergences = await detectDivergences(prisma, tenant.id);

        expect(divergences).toHaveLength(0);
    });

    it('correção atualiza house.address_id para o valor canônico do TBA sem alterar territory_block_address', async () => {
        const { tenant, house, addressTBA, tba } = await criarHouseDivergente();

        const tbaAntes = await prisma.territory_block_address.findUnique({ where: { id: tba.id } });

        await phaseFixDivergence(prisma, tenant.id, false);

        const houseCorrigida = await prisma.house.findUnique({ where: { id: house.id } });
        const tbaDepois = await prisma.territory_block_address.findUnique({ where: { id: tba.id } });

        // house.address_id deve apontar para o endereço canônico do TBA
        expect(houseCorrigida!.addressId).toBe(addressTBA.id);
        // territory_block_address não deve ter sido alterado
        expect(tbaDepois!.id).toBe(tbaAntes!.id);
        expect(tbaDepois!.addressId).toBe(tbaAntes!.addressId);
    });

    it('correção não modifica houses sem divergência', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Tenant Sem Div' } });
        const type = await prisma.type.create({ data: { name: 'Tipo SD', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Território SD', typeId: type.id, tenantId: tenant.id },
        });
        const block = await prisma.block.create({ data: { name: 'Quadra SD', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'Rua Intacta', tenantId: tenant.id } });

        const tb = await prisma.territory_block.create({
            data: { blockId: block.id, territoryId: territory.id, tenantId: tenant.id },
        });
        const tba = await prisma.territory_block_address.create({
            data: { territoryBlockId: tb.id, addressId: address.id, tenantId: tenant.id },
        });

        const house = await prisma.house.create({
            data: {
                number: '11',
                addressId: address.id,
                blockId: block.id,
                territoryId: territory.id,
                tenantId: tenant.id,
                territoryBlockAddressId: tba.id,
            },
        });

        await phaseFixDivergence(prisma, tenant.id, false);

        const houseApos = await prisma.house.findUnique({ where: { id: house.id } });
        expect(houseApos!.addressId).toBe(address.id); // inalterada
    });
});
