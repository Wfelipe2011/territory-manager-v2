import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { AddressBlockService } from './adress-block.service';
import { UpsertBlockDto } from './contracts/UpsertBlockDto';
import { TerritoryBlockService } from './territory-block.service';
import { StreetOrderService, Entry } from '../change-request/street-order.service';


@Injectable()
export class BlockService {
    private readonly logger = new Logger(BlockService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly territoryBlockService: TerritoryBlockService,
        private readonly addressService: AddressBlockService,
        private readonly streetOrder: StreetOrderService
    ) { }

    async upsertBlock(upsertBlockDto: UpsertBlockDto, tenantId: number, territoryId: number) {
        const block = await this.prisma.$transaction(async (prisma) => {
            this.logger.log('Upsert block iniciado');
            await prisma.$queryRaw`SELECT id FROM multi_tenancy WHERE id=${tenantId} FOR UPDATE`;
            if (!await prisma.territory.findFirst({ where: { id: territoryId, tenantId } })) throw new NotFoundException('Território não encontrado');
            if (upsertBlockDto.id && !await prisma.block.findFirst({ where: { id: upsertBlockDto.id, tenantId } })) throw new NotFoundException('Quadra não encontrada');

            if (upsertBlockDto.id && !upsertBlockDto.expectedAddresses) {
                const linked = await prisma.territory_block.findFirst({ where: { tenantId, territoryId, blockId: upsertBlockDto.id }, include: { territory_block_address: { include: { address: true } } } });
                if (linked) for (const address of upsertBlockDto.addresses ?? []) {
                    const previous = linked.territory_block_address.find(a => a.addressId === address.id);
                    if (address.id && !previous) throw new NotFoundException('Rua não encontrada nesta quadra');
                    if (previous && previous.address.name !== address.street.trim())
                        throw new ConflictException('Atualize a página antes de corrigir o nome da rua.');
                }
            }

            if (upsertBlockDto.id && upsertBlockDto.expectedAddresses) {
                await prisma.$queryRaw`SELECT id FROM block WHERE tenant_id=${tenantId} AND id=${upsertBlockDto.id} FOR UPDATE`;
                await prisma.$queryRaw`SELECT tba.id FROM territory_block_address tba JOIN territory_block tb ON tb.id=tba.territory_block_id WHERE tb.tenant_id=${tenantId} AND tb.territory_id=${territoryId} AND tb.block_id=${upsertBlockDto.id} ORDER BY tba.id FOR UPDATE OF tba`;
                await prisma.$queryRaw`SELECT a.id FROM address a WHERE a.tenant_id=${tenantId} AND a.id IN (SELECT tba.address_id FROM territory_block_address tba JOIN territory_block tb ON tb.id=tba.territory_block_id WHERE tb.tenant_id=${tenantId} AND tb.territory_id=${territoryId} AND tb.block_id=${upsertBlockDto.id}) ORDER BY a.id FOR UPDATE`;
                const link = await prisma.territory_block.findFirst({
                    where: { tenantId, territoryId, blockId: upsertBlockDto.id, registrationStatus: 'approved' },
                    include: { block: true, territory_block_address: { where: { registrationStatus: 'approved' }, include: { address: true } } },
                });
                if (!link) throw new NotFoundException('Quadra não encontrada neste território');
                const snapshot = (items: { id?: number; street: string; zipCode?: string | null }[]) =>
                    JSON.stringify(items.map(a => ({ id: a.id, street: a.street, zipCode: a.zipCode || '' })).sort((a, b) => (a.id ?? 0) - (b.id ?? 0)));
                const current = link.territory_block_address.map(a => ({ id: a.addressId, street: a.address.name, zipCode: a.address.zipCode }));
                if (link.block.name !== upsertBlockDto.expectedBlockName || snapshot(current) !== snapshot(upsertBlockDto.expectedAddresses))
                    throw new ConflictException('A quadra foi alterada. Atualize a página e tente novamente.');
                if (upsertBlockDto.addresses.some(a => a.id && !current.some(c => c.id === a.id)))
                    throw new ConflictException('Uma rua não pertence a esta quadra. Atualize a página.');
            }

            let beforeOrder: Entry[] = [];
            if (upsertBlockDto.saveStreetOrder) {
                if (upsertBlockDto.id) {
                    beforeOrder = await this.streetOrder.snapshot(prisma, tenantId, territoryId, upsertBlockDto.id);
                    if (!this.streetOrder.same(upsertBlockDto.expectedStreetOrder, beforeOrder))
                        throw new ConflictException('A ordem ou as ruas foram alteradas. Atualize a página.');
                    for (const address of upsertBlockDto.addresses ?? []) {
                        if (!address.id) continue;
                        const existing = beforeOrder.find(e => e.id === address.id && e.mappingId === address.mappingId && e.status === 'approved');
                        if (!existing) throw new BadRequestException('Vínculo da rua inválido nesta quadra');
                    }
                }
            }

            const block = await prisma.block.upsert({
                where: { id: upsertBlockDto.id ?? 0, tenantId },
                create: {
                    name: upsertBlockDto.name,
                    tenantId,
                },
                update: {
                    name: upsertBlockDto.name,
                    tenantId,
                },
            });

            this.logger.log(`Bloco upsertado com ID: ${block.id}`);
            const territoryBlock = await this.territoryBlockService.linkBlockToTerritory(block.id, territoryId, tenantId, prisma);
            const orderedMappings = await this.addressService.manageAddresses(territoryBlock.id, upsertBlockDto.addresses, tenantId, prisma);
            if (upsertBlockDto.saveStreetOrder)
                await this.streetOrder.applyEdited(prisma, tenantId, territoryId, block.id, beforeOrder, orderedMappings ?? []);
            return block
        }, { timeout: 120_000 });
        await this.addressService.invalidateBlockCaches(tenantId, territoryId, block.id);
        return await this.getTerritoryBlockDetails(block.id, territoryId, tenantId);
    }

    async getTerritoryBlockDetails(blockId: number, territoryId: number, tenantId: number) {
        const rawData = await this.prisma.territory_block.findFirst({
            where: { blockId, territoryId, tenantId, registrationStatus: 'approved' },
            include: {
                block: true,
                territory_block_address: { where: { registrationStatus: 'approved' }, include: { address: true } },
            },
        });

        return {
            id: rawData?.block.id,
            name: rawData?.block.name,
            addresses: rawData?.territory_block_address.sort((a,b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.address.name.localeCompare(b.address.name, 'pt-BR') || a.addressId - b.addressId).map((a) => ({
                id: a.address.id,
                mappingId: a.id,
                position: a.position,
                street: a.address.name,
                zipCode: a.address.zipCode,
            })),
        };
    }

    async getTerritoryBlocks(territoryId: number, tenantId: number) {
        const rawData = await this.prisma.territory_block.findMany({
            where: { territoryId, tenantId, registrationStatus: 'approved' },
            include: {
                block: true,
                territory_block_address: { where: { registrationStatus: 'approved' }, include: { address: true } },
            },
        });

        return rawData.map((raw) => ({
            id: raw.block.id,
            name: raw.block.name,
            addresses: raw.territory_block_address.sort((a,b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.address.name.localeCompare(b.address.name, 'pt-BR') || a.addressId - b.addressId).map((a) => ({
                id: a.address.id,
                mappingId: a.id,
                position: a.position,
                street: a.address.name,
                zipCode: a.address.zipCode,
            })),
        }));
    }

    async deleteBlock(blockId: number, territoryId: number, tenantId: number) {
        return this.prisma.$transaction(async (prisma) => {
            this.logger.log('Iniciando deleteBlock');
            const territoryBlock = await prisma.territory_block.findFirst({ where: { blockId, territoryId, tenantId, registrationStatus: 'approved' }, include: { territory_block_address: true } });
            if (!territoryBlock) {
                this.logger.warn('Quadra não encontrada');
                throw new NotFoundException('Quadra não encontrada');
            }
            this.logger.log(`Encontrado territoryBlock com ID: ${territoryBlock.id}`);

            await prisma.round.deleteMany({
                where: {
                    house: {
                        territoryBlockAddressId: { in: territoryBlock.territory_block_address.map((a) => a.id) },
                        tenantId
                    }
                }
            });
            this.logger.log('Rounds deletados');

            await prisma.house.deleteMany({ where: { territoryBlockAddressId: { in: territoryBlock.territory_block_address.map((a) => a.id) }, tenantId } });
            this.logger.log('Houses deletadas');

            await prisma.territory_block_address.deleteMany({ where: { territoryBlockId: territoryBlock.id, tenantId } });
            this.logger.log('Territory block addresses deletadas');

            await prisma.territory_block.delete({ where: { id: territoryBlock.id, tenantId } });
            this.logger.log('Territory block deletado');
        }, { timeout: 120_000 });
    }
}
