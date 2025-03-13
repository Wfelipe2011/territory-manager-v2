import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { SignatureService } from '../signature/signature.service';
import { ThemeMode } from '@prisma/client';
import { themeColors } from 'src/constants/themeColors';
import dayjs from 'dayjs';
import { CreateRoundDto } from './contracts/CreateRoundDto';

@Injectable()
export class RoundService {
  private logger = new Logger(RoundService.name);
  constructor(
    readonly prisma: PrismaService,
    private readonly signatureService: SignatureService
  ) { }

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
      ri.type,
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
        ri.color_primary, ri.color_secondary, ri.type
    ORDER BY 
        ri.round_number;
    `;
    return rounds;
  }

  async getRoundInfoByRoundNumber(tenantId: number, roundNumber: number): Promise<any> {
    const [round] = await this.prisma.$queryRaw<any[]>`
    SELECT 
      ri.id,
      ri.round_number,
      ri.name,
      ri.theme,
      ri.tenant_id,
      ri.color_primary,
      ri.color_secondary,
      ri.type,
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
        AND r.round_number = ${roundNumber}
    GROUP BY 
        ri.id, ri.round_number, ri.name, ri.theme, ri.tenant_id, 
        ri.color_primary, ri.color_secondary
    ORDER BY 
        ri.round_number;
    `;
    return round;
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

  async startRound(tenantId: number, body: CreateRoundDto): Promise<void> {
    const rounds = await this.prisma.round_info.findMany({
      where: {
        tenantId,
      },
      distinct: ['roundNumber'],
    });

    await this.createRound(tenantId, rounds, body);
  }

  async finishRound(tenantId: number, roundNumber: number): Promise<void> {
    await this.finish(tenantId, roundNumber);
  }

  async getThemeRound(tenantId: number, roundNumber: number) {
    const round = await this.prisma.round_info.findFirst({
      where: {
        tenantId,
        roundNumber,
      },
    });

    return round;
  }

  public async finish(tenantId: number, roundNumber: number): Promise<void> {
    const territories = await this.prisma.round.findMany({
      where: {
        tenantId,
        roundNumber,
      },
      select: {
        territoryId: true,
        multitenancy: true,
      },
      distinct: ['territoryId'],
    });

    this.logger.log(`Finalizando rodada ${roundNumber} para congregação ${territories[0].multitenancy.name}`);
    await Promise.allSettled(territories.map(async territory => this.signatureService.deleteTerritorySignature(territory.territoryId)));

    await this.prisma.round.updateMany({
      where: {
        tenantId,
        roundNumber,
      },
      data: {
        endDate: new Date(),
      },
    });

    this.logger.log(`Rodada ${roundNumber} para congregação ${territories[0].multitenancy.name} finalizada`);
  }

  private async createRound(tenantId: number, rounds: any[], body: CreateRoundDto) {
    await this.prisma.$transaction(async txt => {
      this.logger.log(`Iniciando criação da rodada para o inquilino ${tenantId}`);
      const houses = await txt.house.findMany({
        where: {
          tenantId,
          territory: {
            typeId: body.typeId
          }
        },
        include: {
          address: true,
          block: true,
          territory: {
            include: {
              type: true
            }
          },
          multitenancy: true,
          rounds: {
            where: {
              mode: ThemeMode.default,
              startDate: {
                gte: getRoundStartDate(tenantId),
              },
            },
            select: {
              completed: true,
            }
          }
        },
      });
      if (!houses.length) {
        throw new NotFoundException("Nenhuma casa encontrada para a criação da rodada");
      }
      this.logger.log(`Casas encontradas para o inquilino ${tenantId}: ${houses.length}`);

      const roundInfo = await txt.round_info.create({
        data: {
          roundNumber: rounds.length + 1,
          name: body.name,
          theme: body.theme,
          colorPrimary: body.colorPrimary,
          colorSecondary: body.colorSecondary,
          type: houses[0].territory.type.name,
          tenantId,
        },
      });

      this.logger.log(`Informações da rodada criadas: ${JSON.stringify(roundInfo)}`);

      await txt.round.createMany({
        data: houses.map(house => {
          const leaveLetter = house.rounds.every(r => !r.completed) && body.theme === ThemeMode.default;
          return {
            houseId: house.id,
            blockId: house.blockId,
            territoryId: house.territoryId,
            tenantId: house.tenantId,
            completed: false,
            roundNumber: roundInfo.roundNumber,
            mode: roundInfo.theme,
            leaveLetter
          };
        }),
      });

      this.logger.log(`Rodada ${roundInfo.roundNumber} para congregação ${houses[0].multitenancy.name} iniciada`);
    }, { timeout: 120_000 });
  }
}

function getRoundStartDate(tenantId: number) {
  if (tenantId === 2) return dayjs().subtract(1, 'year').toDate();
  if (tenantId === 5) return dayjs().subtract(3, 'months').toDate();
  if (tenantId === 9) return dayjs().subtract(3, 'months').toDate();
  return dayjs().subtract(6, 'months').toDate();
}

