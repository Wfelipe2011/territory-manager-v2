import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma.service';
import { SignatureService } from '../signature/signature.service';

interface Round {
  id: number;
  roundNumber: number;
  houseId: number;
  territoryId: number;
  blockId: number;
  completed: boolean;
  startDate: Date;
  updateDate: Date | null;
  endDate: Date | null;
  tenantId: number;
}

@Injectable()
export class RoundService {
  private logger = new Logger(RoundService.name);
  constructor(
    readonly prisma: PrismaService,
    private readonly signatureService: SignatureService
  ) {}

  async getAll(tenantId: number): Promise<any> {
    const rounds = await this.prisma.round.findMany({
      where: {
        tenantId,
      },
      distinct: ['roundNumber'],
    });
    return rounds;
  }

  async startRound(tenantId: number): Promise<void> {
    const rounds = await this.prisma.round.findMany({
      where: {
        tenantId,
      },
      distinct: ['roundNumber'],
    });

    if (!rounds.length) {
      await this.createRound(tenantId, rounds);
    } else {
      await this.finish(tenantId);
      await this.createRound(tenantId, rounds);
    }
  }

  private async finish(tenantId: number): Promise<void> {
    const rounds = await this.prisma.round.findMany({
      where: {
        tenantId,
      },
      distinct: ['roundNumber'],
    });

    const territories = await this.prisma.round.findMany({
      where: {
        tenantId,
        roundNumber: rounds.length,
      },
      select: {
        territoryId: true,
        multitenancy: true,
      },
      distinct: ['territoryId'],
    });

    this.logger.log(`Finalizando rodada ${rounds.length} para congregação ${territories[0].multitenancy.name}`);
    await Promise.allSettled(territories.map(async territory => this.signatureService.deleteTerritorySignature(territory.territoryId)));

    await this.prisma.round.updateMany({
      where: {
        tenantId,
        roundNumber: rounds.length,
      },
      data: {
        updateDate: new Date(),
        endDate: new Date(),
      },
    });

    this.logger.log(`Rodada ${rounds.length} para congregação ${territories[0].multitenancy.name} finalizada`);
  }

  private async createRound(tenantId: number, rounds: Round[]) {
    const houses = await this.prisma.house.findMany({
      where: {
        tenantId,
      },
      include: {
        address: true,
        block: true,
        territory: true,
        multitenancy: true,
      },
    });

    await this.prisma.round.createMany({
      data: houses.map(house => {
        return {
          houseId: house.id,
          blockId: house.blockId,
          territoryId: house.territoryId,
          tenantId: house.tenantId,
          completed: false,
          roundNumber: rounds.length + 1,
        };
      }),
    });
    this.logger.log(`Rodada ${rounds.length + 1} para congregação ${houses[0].multitenancy.name} iniciada`);
  }
}
