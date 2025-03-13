import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { UserToken } from '../auth/contracts';
import { PrismaTransaction } from 'src/infra/prisma';

@Injectable()
export class TerritoryBlockService {
    private readonly logger = new Logger(TerritoryBlockService.name);

    constructor(private readonly prisma: PrismaService) { }

    async linkBlockToTerritory(blockId: number, territoryId: number, tenantId: number, prisma: PrismaTransaction = this.prisma) {
        this.logger.log('Verificando associação com o território');
        let territoryBlock = await prisma.territory_block.findFirst({
            where: { blockId, territoryId, tenantId: tenantId },
        });

        if (!territoryBlock) {
            this.logger.log('Criando nova associação com o território', { blockId, territoryId, tenantId });
            territoryBlock = await prisma.territory_block.create({
                data: { blockId, territoryId, tenantId: tenantId },
            });
            this.logger.log(`Território associado com ID: ${territoryBlock.id}`);
        }

        return territoryBlock;
    }
}
