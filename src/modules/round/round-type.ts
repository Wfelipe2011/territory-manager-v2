import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Validate new writes without retargeting or revoking existing legacy links. */
export async function assertTerritoryRoundType(tx: Prisma.TransactionClient, tenantId: number, territoryId: number, roundNumber: number) {
  const territory = await tx.territory.findFirst({ where: { id: territoryId, tenantId }, include: { type: true } });
  if (!territory) throw new NotFoundException('Território não encontrado');
  const info = await tx.round_info.findUnique({ where: { tenantId_roundNumber: { tenantId, roundNumber } } });
  if (!info) throw new NotFoundException('Rodada não encontrada');
  if (info.type !== territory.type.name) throw new BadRequestException('O tipo do território não corresponde ao tipo da rodada');
  return info;
}
