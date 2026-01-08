import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';

describe('Territory Query (findById) e2e', () => {
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

    /**
     * Helper to seed data for query tests
     */
    async function seedTerritoryData(args: {
        tenantId: number;
        roundNumber: number;
        socketCount?: number;
    }) {
        const { tenantId, roundNumber } = args;

        // 1. Create Type
        const type = await prisma.type.create({
            data: { name: 'Residential', tenantId },
        });

        // 2. Create Territory
        const territory = await prisma.territory.create({
            data: {
                name: 'Territory Q1',
                typeId: type.id,
                tenantId,
            },
        });

        // 3. Create Block
        const block = await prisma.block.create({
            data: { name: 'Block A', tenantId },
        });

        // 4. Create Address
        const address = await prisma.address.create({
            data: { name: 'Main St', tenantId },
        });

        // 5. Create Signature
        const signature = await prisma.signature.create({
            data: {
                key: `sig-${Date.now()}`,
                token: 'some-token',
                tenantId,
                expirationDate: new Date(Date.now() + 1000000),
            },
        });

        // 6. Link Territory -> Block (with Signature)
        const territoryBlock = await prisma.territory_block.create({
            data: {
                territoryId: territory.id,
                blockId: block.id,
                tenantId,
                signatureId: signature.id,
            },
        });

        // 7. Create Territory Overseer (History)
        // Must have at least one unfinished (!finished) to pass validation
        await prisma.territory_overseer.create({
            data: {
                territoryId: territory.id,
                overseer: 'Overseer One',
                roundNumber: roundNumber,
                tenantId,
                finished: false, // Active
                signatureId: signature.id,
                initialDate: new Date(),
            },
        });

        // 8. Create Houses & Rounds
        // House 1: Completed
        const house1 = await prisma.house.create({
            data: {
                number: '101',
                blockId: block.id,
                addressId: address.id,
                territoryId: territory.id,
                tenantId,
                territoryBlockAddressId: null, // Depending on logic, might need this or legacy fields
            },
        });
        await prisma.round.create({
            data: {
                roundNumber: roundNumber,
                territoryId: territory.id,
                blockId: block.id,
                houseId: house1.id,
                tenantId,
                completed: true,
                updateDate: new Date(),
            },
        });

        // House 2: Not Completed
        const house2 = await prisma.house.create({
            data: {
                number: '102',
                blockId: block.id,
                addressId: address.id,
                territoryId: territory.id,
                tenantId,
            },
        });
        await prisma.round.create({
            data: {
                roundNumber: roundNumber,
                territoryId: territory.id,
                blockId: block.id,
                houseId: house2.id,
                tenantId,
                completed: false,
                updateDate: new Date(),
            },
        });

        // 9. Create Sockets (Connections)
        // The service does: `where s.room LIKE ${like}` where like = `%${territoryId}-${block.id}%`
        if (args.socketCount && args.socketCount > 0) {
            const roomId = `${territory.id}-${block.id}`; // e.g., "1-1"
            for (let i = 0; i < args.socketCount; i++) {
                await prisma.socket.create({
                    data: {
                        socketId: `socket-${i}-${Date.now()}`,
                        room: `prefix-${roomId}-suffix`, // Testing LIKE
                    },
                });
            }
        }

        return {
            territory,
            block,
            signature,
        };
    }

    it('deve retornar detalhes do território com contagem correta de conexões e estatísticas', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Query Tenant' } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });
        const roundNumber = 5;
        const socketCount = 3;

        const { territory, block } = await seedTerritoryData({
            tenantId: tenant.id,
            roundNumber,
            socketCount,
        });

        const response = await request(app.getHttpServer())
            .get(`/v1/territories/${territory.id}?round=${roundNumber}`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        const data = response.body;

        expect(data.territoryId).toBe(territory.id);
        expect(data.territoryName).toBe(territory.name);
        expect(data.hasRounds).toBe(true);

        // Check stats
        // We added 1 completed house, 1 not completed
        // The query groups and sums
        // Check blocks array
        expect(data.blocks).toHaveLength(1);
        const blockDto = data.blocks[0];
        expect(blockDto.id).toBe(block.id);
        expect(blockDto.connections).toBe(socketCount); // 3

        // Due to `GROUP BY` and how `RawTerritoryOne` maps to `TerritoryOneOutput`,
        // let's verify aggregated numbers if exposed, or implied by logic.
        // The output class `TerritoryOneOutput` typically maps these raw fields.
        // Looking at the service:
        // const territoryDto = new TerritoryOneOutput(territory);
        // We'd expect `positiveCompleted` and `negativeCompleted` if exposed.
        // Let's print data to see structure if unsure of DTO, but based on service code:
        expect(blockDto.positiveCompleted).toBe(1);
        expect(blockDto.negativeCompleted).toBe(1);
    });

    it('deve retornar 404 se o território não existir', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Missing Tenant' } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        const response = await request(app.getHttpServer())
            .get(`/v1/territories/999999?round=1`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(404);
        expect(response.body.message).toBe('Território não encontrado');
    });

    it('deve retornar 404 se o território não tiver histórico', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'History Tenant' } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });
        const type = await prisma.type.create({ data: { name: 'Type', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'No History', typeId: type.id, tenantId: tenant.id },
        });

        // Even with some data, if `territory_overseer` is missing for the round, it fails query or check
        // The query uses `LEFT JOIN territory_overseer`, so it returns result but `tov.overseer` is null.
        // Then `new TerritoryOneOutput(territory)` processes it.
        // Then `if (!territoryDto.history.length)` check fails.

        // We need rounds to match INNER JOIN in the query?
        // `INNER JOIN round ON round.house_id = h.id AND round.round_number = ${+round}`
        // If no rounds, the query returns empty array?
        // Yes, INNER JOIN round means if no rounds, territory query returns [] -> "Território não encontrado"

        // So let's add round but no overseer.
        const block = await prisma.block.create({ data: { name: 'B', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'S', tenantId: tenant.id } });
        const house = await prisma.house.create({
            data: { number: '1', blockId: block.id, addressId: address.id, territoryId: territory.id, tenantId: tenant.id },
        });
        await prisma.round.create({
            data: { roundNumber: 1, territoryId: territory.id, blockId: block.id, houseId: house.id, tenantId: tenant.id, completed: false },
        });

        // Now query returns row(s) because round exists.
        // But `territory_overseer` will be null.

        const response = await request(app.getHttpServer())
            .get(`/v1/territories/${territory.id}?round=1`)
            .set('Authorization', `Bearer ${token}`);

        // Logic:
        // The query returns rows.
        // `new TerritoryOneOutput(territory)` creates history list from rows.
        // If overseer is null, history might be empty?
        // Service: `if (!territoryDto.history.length) throw ...`


        expect(response.status).toBe(404);
        // Expect "Território: ... não tem histórico" OR "Território não encontrado" depending on how DTO handles nulls.
    });

    it('deve lidar com múltiplas quadras e garantir ordenação por conclusões negativas', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Multi Block Tenant' } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });
        const roundNumber = 10;

        // Base setup
        const type = await prisma.type.create({ data: { name: 'Res', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Multiblock Terr', typeId: type.id, tenantId: tenant.id },
        });
        const address = await prisma.address.create({ data: { name: 'St', tenantId: tenant.id } });
        const signature = await prisma.signature.create({
            data: { key: 'sig-mb', token: 'tk', tenantId: tenant.id, expirationDate: new Date() },
        });

        // History needed
        await prisma.territory_overseer.create({
            data: {
                territoryId: territory.id,
                overseer: 'Overseer MB',
                roundNumber,
                tenantId: tenant.id,
                finished: false, // Active
                signatureId: signature.id,
                initialDate: new Date(),
            },
        });

        // Block A: 1 negative
        const blockA = await prisma.block.create({ data: { name: 'Block A', tenantId: tenant.id } });
        await prisma.territory_block.create({
            data: { territoryId: territory.id, blockId: blockA.id, tenantId: tenant.id, signatureId: signature.id },
        });
        const houseA = await prisma.house.create({
            data: { number: 'A1', blockId: blockA.id, addressId: address.id, territoryId: territory.id, tenantId: tenant.id },
        });
        await prisma.round.create({
            data: { roundNumber, territoryId: territory.id, blockId: blockA.id, houseId: houseA.id, tenantId: tenant.id, completed: false },
        });

        // Block B: 3 negative (more than A)
        const blockB = await prisma.block.create({ data: { name: 'Block B', tenantId: tenant.id } });
        await prisma.territory_block.create({
            data: { territoryId: territory.id, blockId: blockB.id, tenantId: tenant.id, signatureId: signature.id },
        });
        // Create 3 negative rounds for B
        for (let i = 1; i <= 3; i++) {
            const h = await prisma.house.create({
                data: { number: `B${i}`, blockId: blockB.id, addressId: address.id, territoryId: territory.id, tenantId: tenant.id },
            });
            await prisma.round.create({
                data: { roundNumber, territoryId: territory.id, blockId: blockB.id, houseId: h.id, tenantId: tenant.id, completed: false },
            });
        }

        const response = await request(app.getHttpServer())
            .get(`/v1/territories/${territory.id}?round=${roundNumber}`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        const blocks = response.body.blocks;
        expect(blocks).toHaveLength(2);

        // Block B has 3 negative, Block A has 1 negative.
        // Query: ORDER BY negative_completed DESC
        // First should be Block B
        expect(blocks[0].id).toBe(blockB.id);
        expect(blocks[0].negativeCompleted).toBe(3);

        expect(blocks[1].id).toBe(blockA.id);
        expect(blocks[1].negativeCompleted).toBe(1);
    });

    it('deve ignorar casas "ghost" nas estatísticas', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Ghost Tenant' } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });
        const roundNumber = 20;

        // Use seed for basic structure
        const { territory, block } = await seedTerritoryData({
            tenantId: tenant.id,
            roundNumber,
        });

        // seedTerritoryData adds 1 positive, 1 negative regular houses.
        // Let's add ghost houses.
        const address = await prisma.address.create({ data: { name: 'G-Street', tenantId: tenant.id } });

        // Ghost + Completed
        const ghost1 = await prisma.house.create({
            data: { number: 'ghost', blockId: block.id, addressId: address.id, territoryId: territory.id, tenantId: tenant.id },
        });
        await prisma.round.create({
            data: { roundNumber, territoryId: territory.id, blockId: block.id, houseId: ghost1.id, tenantId: tenant.id, completed: true },
        });

        // Ghost + Not Completed
        const ghost2 = await prisma.house.create({
            data: { number: 'ghost', blockId: block.id, addressId: address.id, territoryId: territory.id, tenantId: tenant.id },
        });
        await prisma.round.create({
            data: { roundNumber, territoryId: territory.id, blockId: block.id, houseId: ghost2.id, tenantId: tenant.id, completed: false },
        });

        const response = await request(app.getHttpServer())
            .get(`/v1/territories/${territory.id}?round=${roundNumber}`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        const blockDto = response.body.blocks[0];

        // Should still be 1 and 1 from the seed data.
        // Ghost houses are ignored by `h.number != 'ghost'` in SUM CASE.
        expect(blockDto.positiveCompleted).toBe(1);
        expect(blockDto.negativeCompleted).toBe(1);
    });

    it('deve isolar dados por rodada (round)', async () => {
        const tenant = await prisma.multitenancy.create({ data: { name: 'Round Tenant' } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });

        // Setup
        const type = await prisma.type.create({ data: { name: 'R-Type', tenantId: tenant.id } });
        const territory = await prisma.territory.create({
            data: { name: 'Round Isolation', typeId: type.id, tenantId: tenant.id },
        });
        const block = await prisma.block.create({ data: { name: 'B', tenantId: tenant.id } });
        const address = await prisma.address.create({ data: { name: 'S', tenantId: tenant.id } });
        const house = await prisma.house.create({
            data: { number: '1', blockId: block.id, addressId: address.id, territoryId: territory.id, tenantId: tenant.id }
        });

        const sig = await prisma.signature.create({
            data: { key: 'rk', token: 'rt', tenantId: tenant.id, expirationDate: new Date() }
        });
        await prisma.territory_block.create({
            data: { territoryId: territory.id, blockId: block.id, signatureId: sig.id, tenantId: tenant.id }
        });

        // Round 1
        await prisma.round.create({
            data: { roundNumber: 1, territoryId: territory.id, blockId: block.id, houseId: house.id, tenantId: tenant.id, completed: true }
        });
        await prisma.territory_overseer.create({
            data: { territoryId: territory.id, overseer: 'Overseer R1', roundNumber: 1, tenantId: tenant.id, finished: false, signatureId: sig.id, initialDate: new Date() }
        });

        // Round 2
        await prisma.round.create({
            data: { roundNumber: 2, territoryId: territory.id, blockId: block.id, houseId: house.id, tenantId: tenant.id, completed: false } // Diff status
        });
        await prisma.territory_overseer.create({
            data: { territoryId: territory.id, overseer: 'Overseer R2', roundNumber: 2, tenantId: tenant.id, finished: false, signatureId: sig.id, initialDate: new Date() }
        });

        // Query Round 1
        const res1 = await request(app.getHttpServer())
            .get(`/v1/territories/${territory.id}?round=1`)
            .set('Authorization', `Bearer ${token}`);

        expect(res1.status).toBe(200);
        expect(res1.body.blocks[0].positiveCompleted).toBe(1); // Completed=true
        // Check history overseer name if possible, or infer from context. 
        // The DTO `history` array comes from `territory_overseer` joined by round.
        expect(res1.body.history[0].overseer).toBe('Overseer R1');

        // Query Round 2
        const res2 = await request(app.getHttpServer())
            .get(`/v1/territories/${territory.id}?round=2`)
            .set('Authorization', `Bearer ${token}`);

        expect(res2.status).toBe(200);
        expect(res2.body.blocks[0].positiveCompleted).toBe(0); // Completed=false -> positive 0
        expect(res2.body.history[0].overseer).toBe('Overseer R2');
    });

    it('deve contar conexões corretamente mesmo com IDs de blocos que são prefixos de outros (ex: 1 e 11)', async () => {
        // Reset IDs to ensure we can create Block 1 and Block 11 deterministically
        // Use CASCADE to clear dependencies like houses, rounds, etc.
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE "block", "territory", "house", "round", "socket", "territory_block", "territory_overseer", "type", "multi_tenancy", "address", "signature" RESTART IDENTITY CASCADE;`);

        const tenant = await prisma.multitenancy.create({ data: { name: 'Socket Tenant' } });
        const token = createTestToken({ tenantId: tenant.id, roles: [Role.ADMIN] });
        const type = await prisma.type.create({ data: { name: 'Socket Type', tenantId: tenant.id } });

        const territory = await prisma.territory.create({
            data: { name: 'T1', typeId: type.id, tenantId: tenant.id }
        });

        // Setup Block 1
        const block1 = await prisma.block.create({ data: { name: 'Block 1', tenantId: tenant.id } });
        // ID depends on if previous tests incremented sequence even with truncate? 
        // RESTART IDENTITY resets to 1.
        expect(block1.id).toBe(1);

        // Burn IDs to get to 11
        for (let i = 2; i < 11; i++) {
            await prisma.block.create({ data: { name: `Burn ${i}`, tenantId: tenant.id } });
        }

        // Setup Block 11
        const block11 = await prisma.block.create({ data: { name: 'Block 11', tenantId: tenant.id } });
        expect(block11.id).toBe(11);

        // Needed for query
        const signature = await prisma.signature.create({
            data: { key: 'sock-key', token: 'st', tenantId: tenant.id, expirationDate: new Date() }
        });
        await prisma.territory_overseer.create({
            data: {
                territoryId: territory.id, overseer: 'O', roundNumber: 1, tenantId: tenant.id, finished: false, signatureId: signature.id, initialDate: new Date()
            }
        });

        await prisma.territory_block.createMany({
            data: [
                { territoryId: territory.id, blockId: block1.id, tenantId: tenant.id, signatureId: signature.id },
                { territoryId: territory.id, blockId: block11.id, tenantId: tenant.id, signatureId: signature.id }
            ]
        });

        const address = await prisma.address.create({ data: { name: 'A', tenantId: tenant.id } });

        // Rounds
        const h1 = await prisma.house.create({ data: { number: '1', blockId: block1.id, addressId: address.id, territoryId: territory.id, tenantId: tenant.id } });
        await prisma.round.create({ data: { roundNumber: 1, territoryId: territory.id, blockId: block1.id, houseId: h1.id, tenantId: tenant.id, completed: false } });

        const h11 = await prisma.house.create({ data: { number: '11', blockId: block11.id, addressId: address.id, territoryId: territory.id, tenantId: tenant.id } });
        await prisma.round.create({ data: { roundNumber: 1, territoryId: territory.id, blockId: block11.id, houseId: h11.id, tenantId: tenant.id, completed: false } });

        // CREATE SOCKET FOR BLOCK 11 ONLY
        // room = `${territory.id}-${block11.id}` -> "1-11"
        // Pattern for Block 1 is %1-1%
        // "prefix-1-11-suffix" contains "1-1"
        await prisma.socket.create({
            data: {
                socketId: 'sock-11',
                room: `prefix-${territory.id}-${block11.id}-suffix`
            }
        });

        const response = await request(app.getHttpServer())
            .get(`/v1/territories/${territory.id}?round=1`)
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);

        const b1Dto = response.body.blocks.find((b: any) => b.id === block1.id);
        const b11Dto = response.body.blocks.find((b: any) => b.id === block11.id);

        expect(b11Dto.connections).toBe(1);
        // This expectation will fail if the bug exists
        expect(b1Dto.connections).toBe(0);
    });
});
