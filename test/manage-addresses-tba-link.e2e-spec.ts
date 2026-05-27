import { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { AddressBlockService } from '../src/modules/block/adress-block.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

describe('manageAddresses — vinculação de houses stale ao criar TBA (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let addressBlockService: AddressBlockService;
    let cacheManager: Cache;

    beforeAll(async () => {
        app = await createTestApp();
        prisma = app.get(PrismaService);
        addressBlockService = app.get(AddressBlockService);
        cacheManager = app.get(CACHE_MANAGER);
        await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        await cleanDatabase(prisma);
        await cacheManager.reset();
    });

    it('ao criar novo TBA, houses stale do mesmo endereço são vinculadas automaticamente', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Tenant TBA Link' } });
        const type = await prisma.type.create({ data: { name: 'Tipo TBA', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Território TBA', typeId: type.id, tenantId: tenant.id },
        });
        const block = await prisma.block.create({ data: { name: 'Quadra TBA', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'Rua Stale', tenantId: tenant.id } });

        const tb = await prisma.territory_block.create({
            data: { blockId: block.id, territoryId: territory.id, tenantId: tenant.id },
        });

        // Arrange: house stale com territoryBlockAddressId = null
        const houseStale = await prisma.house.create({
            data: {
                number: '77',
                addressId: address.id,
                blockId: block.id,
                territoryId: territory.id,
                tenantId: tenant.id,
                territoryBlockAddressId: null,
            },
        });
        expect(houseStale.territoryBlockAddressId).toBeNull();

        // Act: manageAddresses cria o TBA para o endereço
        await addressBlockService.manageAddresses(
            tb.id,
            [{ id: address.id, street: 'Rua Stale' }],
            tenant.id,
        );

        // Assert: house stale deve estar vinculada ao TBA recém-criado
        const tba = await prisma.territory_block_address.findFirst({
            where: { territoryBlockId: tb.id, addressId: address.id, tenantId: tenant.id },
        });
        expect(tba).not.toBeNull();

        const houseAtualizada = await prisma.house.findUnique({ where: { id: houseStale.id } });
        expect(houseAtualizada!.territoryBlockAddressId).toBe(tba!.id);
    });

    it('houses stale de outro bloco não são vinculadas ao criar TBA para um bloco específico', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Tenant Isolado' } });
        const type = await prisma.type.create({ data: { name: 'Tipo Isolado', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Território Isolado', typeId: type.id, tenantId: tenant.id },
        });
        const blockAlvo = await prisma.block.create({ data: { name: 'Quadra Alvo', tenantId: tenant.id } });
        const blockOutro = await prisma.block.create({ data: { name: 'Quadra Outro', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'Rua Compartilhada', tenantId: tenant.id } });

        const tbAlvo = await prisma.territory_block.create({
            data: { blockId: blockAlvo.id, territoryId: territory.id, tenantId: tenant.id },
        });

        // House stale no outro bloco — não deve ser vinculada ao TBA do bloco alvo
        const houseOutro = await prisma.house.create({
            data: {
                number: '88',
                addressId: address.id,
                blockId: blockOutro.id,
                territoryId: territory.id,
                tenantId: tenant.id,
                territoryBlockAddressId: null,
            },
        });

        // Act: cria TBA apenas no bloco alvo
        await addressBlockService.manageAddresses(
            tbAlvo.id,
            [{ id: address.id, street: 'Rua Compartilhada' }],
            tenant.id,
        );

        // Assert: house do outro bloco permanece stale
        const houseApos = await prisma.house.findUnique({ where: { id: houseOutro.id } });
        expect(houseApos!.territoryBlockAddressId).toBeNull();
    });

    it('chamar manageAddresses duas vezes não cria houses duplicadas', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Tenant Idem' } });
        const type = await prisma.type.create({ data: { name: 'Tipo Idem', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Território Idem', typeId: type.id, tenantId: tenant.id },
        });
        const block = await prisma.block.create({ data: { name: 'Quadra Idem', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'Rua Idem', tenantId: tenant.id } });

        const tb = await prisma.territory_block.create({
            data: { blockId: block.id, territoryId: territory.id, tenantId: tenant.id },
        });

        // Primeira chamada: cria TBA e ghost house
        await addressBlockService.manageAddresses(
            tb.id,
            [{ id: address.id, street: 'Rua Idem' }],
            tenant.id,
        );
        const countPrimeira = await prisma.house.count({
            where: { tenantId: tenant.id, addressId: address.id },
        });

        // Segunda chamada: não deve criar duplicatas
        await addressBlockService.manageAddresses(
            tb.id,
            [{ id: address.id, street: 'Rua Idem' }],
            tenant.id,
        );
        const countSegunda = await prisma.house.count({
            where: { tenantId: tenant.id, addressId: address.id },
        });

        expect(countSegunda).toBe(countPrimeira);
    });
});
