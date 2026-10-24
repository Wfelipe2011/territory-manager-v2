import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ThemeMode } from '@prisma/client';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { calculateLeaveLetter } from './calculate-leave-letter';

@Injectable()
export class CatalogRoundService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(tenantId: number, territoryId: number, round?: number | string | null, tx: Prisma.TransactionClient = this.prisma) {
    const territory = await tx.territory.findFirst({ where: { id: territoryId, tenantId }, include: { type: true } });
    if (!territory) throw new NotFoundException('Território não encontrado');
    if (round != null) {
      const info = await tx.round_info.findUnique({ where: { tenantId_roundNumber: { tenantId, roundNumber: +round } } });
      if (!info) throw new NotFoundException('Rodada não encontrada');
      return info;
    }
    return tx.round_info.findFirst({
      where: { tenantId, status: 'open', OR: [{ typeIds: { has: territory.typeId } }, { typeIds: { isEmpty: true }, type: territory.type.name }] },
      orderBy: { roundNumber: 'desc' },
    });
  }

  async attachHouse(tx: Prisma.TransactionClient, tenantId: number, houseId: number, options: { autoStart?: boolean; round?: number | string | null } = {}) {
    const house = await tx.house.findFirstOrThrow({
      where: { id: houseId, tenantId, registrationStatus: { not: 'rejected' } },
      include: { rounds: { where: { mode: ThemeMode.default } } },
    });
    // Callers hold the tenant lock, shared with manual round creation/review.
    let info = await this.resolve(tenantId, house.territoryId, options.round, tx);
    if (info?.status !== 'open' && info) return;
    if (!info && options.autoStart) {
      const territory = await tx.territory.findUniqueOrThrow({ where: { id: house.territoryId }, include: { type: true } });
      info = await tx.round_info.create({ data: {
        tenantId, roundNumber: ((await tx.round_info.aggregate({ where: { tenantId }, _max: { roundNumber: true } }))._max.roundNumber ?? 0) + 1,
        name: 'Rodada de campo', theme: ThemeMode.default, status: 'open', typeIds: [territory.typeId], type: territory.type.name,
        colorPrimary: '#7AAD58', colorSecondary: '#CBE6BA', startedAt: new Date(),
      } });
      const eligible = await tx.house.findMany({ where: {
        tenantId, registrationStatus: { not: 'rejected' }, number: { not: 'ghost' }, territory: { typeId: territory.typeId },
        OR: [{ territoryBlockAddressId: null }, { territoryBlockAddress: { registrationStatus: { not: 'rejected' }, territoryBlock: { registrationStatus: { not: 'rejected' } } } }],
      }, include: { rounds: { where: { mode: ThemeMode.default }, select: { completed: true, completedDate: true } } } });
      const date = await this.historyDate(tx, tenantId);
      await tx.round.createMany({ data: eligible.map(h => ({
        tenantId, houseId: h.id, territoryId: h.territoryId, blockId: h.blockId, roundNumber: info!.roundNumber,
        mode: ThemeMode.default, completed: false, leaveLetter: calculateLeaveLetter(h.rounds, ThemeMode.default, date),
      })), skipDuplicates: true });
      return;
    }
    if (!info) return;
    const date = await this.historyDate(tx, tenantId);
    await tx.round.createMany({ data: [{
      houseId, tenantId, territoryId: house.territoryId, blockId: house.blockId, roundNumber: info.roundNumber,
      mode: info.theme, completed: false, leaveLetter: calculateLeaveLetter(house.rounds, info.theme, date),
    }], skipDuplicates: true });
  }

  private async historyDate(tx: Prisma.TransactionClient, tenantId: number) {
    const setting = await tx.parameter.findUnique({ where: { tenantId_key: { tenantId, key: 'ROUND_START_DATE_MONTHS' } } });
    const months = Number(setting?.value ?? 6);
    const date = new Date();
    date.setMonth(date.getMonth() - (Number.isFinite(months) && months > 0 ? months : 6));
    return date;
  }
}
