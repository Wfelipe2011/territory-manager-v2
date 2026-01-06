import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { AddressBlockService } from '../block/adress-block.service';

export type CreateHouseInput = {
  streetId: number;
  number: string;
  legend: string;
  dontVisit: boolean;
  territoryId: number;
  blockId: number;
};

@Injectable()
export class HouseWorkerService {
  private logger = new Logger(HouseWorkerService.name);
  constructor(readonly prisma: PrismaService, readonly addressBlockService: AddressBlockService) { }

  // @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async removeGhostHouse() {
    this.logger.log('Iniciando a tarefa de remoção de casas fantasmas');
    const ghostHouses = await this.prisma.house.findMany({
      where: {
        number: 'ghost',
      },
    });

    this.logger.log(`Encontradas ${ghostHouses.length} casas fantasmas`);

    for (const ghostHouse of ghostHouses) {
      await this.prisma.$transaction(async tsx => {
        const houses = await tsx.house.count({
          where: {
            territoryBlockAddressId: ghostHouse.territoryBlockAddressId,
          },
        });

        this.logger.log(`Casa fantasma ID ${ghostHouse.id} tem ${houses} casas no mesmo bloco`);
        if (houses > 1) {
          await tsx.round.deleteMany({
            where: {
              houseId: ghostHouse.id,
            },
          });
          this.logger.log(`Removidos todos os rounds da casa fantasma ID ${ghostHouse.id}`);
          await tsx.house.delete({
            where: {
              id: ghostHouse.id,
            },
          });
          this.logger.log(`Deletada casa fantasma ID ${ghostHouse.id}`);
        }
      }).catch(err => {
        this.logger.error(`Erro ao remover casa fantasma ID ${ghostHouse.id}`);
        this.logger.error(err);
      });
    }

    this.logger.log('Tarefa de remoção de casas fantasmas concluída');
  }

  // @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async createGhostHouse() {
    this.logger.log('Iniciando a tarefa de criação de casas fantasmas');
    const blocks = await this.prisma.territory_block_address.findMany({
      where: {
        house: {
          none: {},
        },
      },
      include: {
        territoryBlock: true,
      },
    });
    this.logger.log(`Encontrados ${blocks.length} blocos sem casas`);

    for (const block of blocks) {
      await this.prisma.$transaction(async tsx => {
        await this.addressBlockService.createGhostHouse(block.addressId, block.territoryBlock, block.id, block.tenantId, tsx);
      }).catch(err => {
        this.logger.error(`Erro ao criar casa fantasma para bloco ID ${block.territoryBlock.blockId}`);
        this.logger.error(err);
      });
    }
    this.logger.log('Tarefa de criação de casas fantasmas concluída');
  }
}