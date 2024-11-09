import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma.service';
import { SignatureService } from '../signature/signature.service';
import { ThemeMode } from '@prisma/client';

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

  async getRoundInfo(tenantId: number): Promise<any> {
    const rounds = await this.prisma.$queryRaw`
    SELECT 
      ri.id,
      ri.round_number,
      ri.name,
      ri.theme,
      ri.tenant_id,
      ri.color_primary,
      ri.color_secondary,
      MIN(r.start_date) AS start_date,
      MAX(r.end_date) AS end_date,
      CAST(SUM(CASE WHEN r.completed = TRUE THEN 1 ELSE 0 END) AS INT) AS completed,
      CAST(SUM(CASE WHEN r.completed = FALSE THEN 1 ELSE 0 END) AS INT) AS not_completed
    FROM 
        round_info ri
    INNER JOIN 
        round r ON r.round_number = ri.round_number 
                AND r.tenant_id = ri.tenant_id
    WHERE 
        r.tenant_id = ${tenantId}
    GROUP BY 
        ri.id, ri.round_number, ri.name, ri.theme, ri.tenant_id, 
        ri.color_primary, ri.color_secondary
    ORDER BY 
        ri.round_number;
    `;
    return rounds;
  }

  async fixRoundInfo(): Promise<any> {
    const rawRounds = (await this.prisma.$queryRaw`
      SELECT r.round_number, r.tenant_id, r."mode"
      FROM round r
      GROUP BY r.round_number, r.tenant_id, r."mode"
      ORDER BY r.tenant_id ASC, r.round_number ASC
    `) as any[];
    for (const round of rawRounds) {
      let name = 'Residencial';
      let colorPrimary = '#7AAD58';
      let colorSecondary = '#CBE6BA';
      if (round.mode === 'letters') {
        name = 'Cartas';
        colorPrimary = '#E29D4F';
        colorSecondary = '#FDD09FB2';
      }
      if (round.mode === 'campaign') {
        name = 'Campanha';
        colorPrimary = '#5B98AB';
        colorSecondary = '#EAF2F4';
      }
      await this.prisma.round_info.create({
        data: {
          roundNumber: round.round_number,
          tenantId: round.tenant_id,
          theme: round.mode as any,
          name,
          colorPrimary,
          colorSecondary,
        },
      });
    }
    return rawRounds;
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

  async getThemeRound(tenantId: number, roundNumber: number): Promise<ThemeMode> {
    const round = await this.prisma.round.findFirst({
      where: {
        tenantId,
        roundNumber,
      },
    });

    if (!round) {
      return ThemeMode.default;
    }

    return round.mode;
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
