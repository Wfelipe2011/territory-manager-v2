import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { AddressBlockService } from './adress-block.service';
import { UpsertBlockDto } from './contracts/UpsertBlockDto';
import { TerritoryBlockService } from './territory-block.service';


@Injectable()
export class BlockService {
    private readonly logger = new Logger(BlockService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly territoryBlockService: TerritoryBlockService,
        private readonly addressService: AddressBlockService
    ) { }

    async upsertBlock(upsertBlockDto: UpsertBlockDto, tenantId: number, territoryId: number) {
        const block = await this.prisma.$transaction(async (prisma) => {
            this.logger.log('Upsert block iniciado');

            const block = await prisma.block.upsert({
                where: { id: upsertBlockDto.id ?? 0 },
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
            await this.addressService.manageAddresses(territoryBlock.id, upsertBlockDto.addresses, tenantId, prisma);
            return block
        }, { timeout: 120_000 });
        return await this.getTerritoryBlockDetails(block.id, territoryId, tenantId);
    }

    async getTerritoryBlockDetails(blockId: number, territoryId: number, tenantId: number) {
        const territoryBlock = await this.prisma.territory_block.findFirst({ where: { blockId, territoryId, tenantId } })
        const rawData = await this.prisma.territory_block.findFirst({
            where: { id: territoryBlock?.id },
            include: {
                block: true,
                territory_block_address: { include: { address: true } },
            },
        });

        return {
            id: rawData?.block.id,
            name: rawData?.block.name,
            addresses: rawData?.territory_block_address.map((a) => ({
                id: a.address.id,
                street: a.address.name,
                zipCode: a.address.zipCode,
            })),
        };
    }

    async getTerritoryBlocks(territoryId: number, tenantId: number) {
        const rawData = await this.prisma.territory_block.findMany({
            where: { territoryId, tenantId },
            include: {
                block: true,
                territory_block_address: { include: { address: true } },
            },
        });

        return rawData.map((raw) => ({
            id: raw.block.id,
            name: raw.block.name,
            addresses: raw.territory_block_address.map((a) => ({
                id: a.address.id,
                street: a.address.name,
                zipCode: a.address.zipCode,
            })),
        }));
    }

    async deleteBlock(blockId: number, territoryId: number, tenantId: number) {
        return this.prisma.$transaction(async (prisma) => {
            this.logger.log('Iniciando deleteBlock');
            const territoryBlock = await prisma.territory_block.findFirst({ where: { blockId, territoryId, tenantId }, include: { territory_block_address: true } });
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
