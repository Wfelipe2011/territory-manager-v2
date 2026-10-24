import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { SignatureService } from '../signature/signature.service';
import { ThemeMode } from '@prisma/client';
import { themeColors } from 'src/constants/themeColors';
import dayjs from 'dayjs';
import { CreateRoundDto } from './contracts/CreateRoundDto';
import { ParametersService } from '../parameters/parameters.service';
import { calculateLeaveLetter } from './calculate-leave-letter';

@Injectable()
export class RoundService {
  private logger = new Logger(RoundService.name);
  constructor(
    readonly prisma: PrismaService,
    private readonly signatureService: SignatureService,
    private readonly parametersService: ParametersService
  ) { }

  async getRoundInfo(tenantId: number): Promise<any> {
    return this.prisma.$queryRaw`
      SELECT ri.id,ri.round_number,ri.name,ri.theme,ri.tenant_id,ri.color_primary,ri.color_secondary,ri.type,ri.type_ids,ri.status,
       COALESCE(MIN(r.start_date),ri.started_at) start_date,CASE WHEN ri.status='closed' THEN COALESCE(ri.closed_at,MAX(r.end_date)) ELSE NULL END end_date,
       CAST(COUNT(r.id) FILTER(WHERE r.completed) AS INT) completed,CAST(COUNT(r.id) FILTER(WHERE NOT r.completed) AS INT) not_completed
      FROM round_info ri LEFT JOIN round r ON r.tenant_id=ri.tenant_id AND r.round_number=ri.round_number
       AND EXISTS(SELECT 1 FROM house h WHERE h.id=r.house_id AND h.registration_status='approved' AND h.number<>'ghost')
      WHERE ri.tenant_id=${tenantId} GROUP BY ri.id ORDER BY ri.round_number`;
  }
  async getRoundInfoByRoundNumber(tenantId: number, roundNumber: number): Promise<any> {
    return (await this.getRoundInfo(tenantId)).find((round:any)=>round.round_number===roundNumber);
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

  public async finish(tenantId:number,roundNumber:number):Promise<void> {
    const leaders=await this.prisma.territory_overseer.findMany({where:{tenantId,roundNumber,signatureId:{not:null}},select:{territoryId:true},distinct:['territoryId']});
    await this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM multi_tenancy WHERE id=${tenantId} FOR UPDATE`;
      const info=await tx.round_info.findUnique({where:{tenantId_roundNumber:{tenantId,roundNumber}}});
      if(!info)throw new NotFoundException('Rodada não encontrada');
      const closedAt=new Date();
      await tx.round_info.update({where:{id:info.id},data:{status:'closed',closedAt}});
      await tx.round.updateMany({where:{tenantId,roundNumber},data:{endDate:closedAt}});
    });
    await Promise.allSettled(leaders.map(leader=>this.signatureService.deleteTerritorySignature(leader.territoryId,tenantId,roundNumber)));
  }

  private async createRound(tenantId: number, rounds: any[], body: CreateRoundDto) {
    const roundStartDate = await this.getRoundStartDate(tenantId);
    await this.prisma.$transaction(async txt => {
      this.logger.log(`Iniciando criação da rodada para o inquilino ${tenantId}`);
      await txt.$queryRaw`SELECT id FROM multi_tenancy WHERE id=${tenantId} FOR UPDATE`;
      const type=await txt.type.findFirst({where:{id:+body.typeId,tenantId}});
      if(!type)throw new NotFoundException('Tipo não encontrado');
      const houses = await txt.house.findMany({
        where: {
          tenantId,
          registrationStatus: 'approved',
          number: { not: 'ghost' },
          territoryBlockAddress: {registrationStatus:'approved',territoryBlock:{registrationStatus:'approved'}},
          territory: {
            typeId: body.typeId
          },
          territoryBlockAddressId: { not: null },
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
            },
            select: {
              completed: true,
              completedDate: true,
            }
          }
        },
      });
      this.logger.log(`Casas encontradas para o inquilino ${tenantId}: ${houses.length}`);

      const roundInfo = await txt.round_info.create({
        data: {
          roundNumber: ((await txt.round_info.aggregate({where:{tenantId},_max:{roundNumber:true}}))._max.roundNumber??0)+1,
          status:'open',typeIds:[type.id],startedAt:new Date(),
          name: body.name,
          theme: body.theme,
          colorPrimary: body.colorPrimary,
          colorSecondary: body.colorSecondary,
          type: type.name,
          tenantId,
        },
      });

      this.logger.log(`Informações da rodada criadas: ${JSON.stringify(roundInfo)}`);

      await txt.round.createMany({
        data: houses.map(house => {
          const leaveLetter = calculateLeaveLetter(house.rounds, body.theme, roundStartDate);
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

      this.logger.log(`Rodada ${roundInfo.roundNumber} iniciada para tenant ${tenantId}`);
    }, { timeout: 120_000 });
  }

  private async getRoundStartDate(tenantId: number) {
    const customMonths = await this.parametersService.getValue(tenantId, 'ROUND_START_DATE_MONTHS');
    if (customMonths) {
      return dayjs().subtract(parseInt(customMonths), 'months').toDate();
    }
    return dayjs().subtract(6, 'months').toDate();
  }
}

