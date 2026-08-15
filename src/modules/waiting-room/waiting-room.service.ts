import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { envs } from 'src/infra/envs';
import { PrismaService } from 'src/infra/prisma/prisma.service';

import { BlockService } from '../block/block.service';
import { EventsBusService } from '../events-bus/events-bus.service';
import { SignatureService } from '../signature/signature.service';
import { CreateAssignmentDto } from './contracts/CreateAssignmentDto';
import { DeleteAssignmentDto } from './contracts/DeleteAssignmentDto';
import { JoinRoomDto } from './contracts/JoinRoomDto';

const PRESENCE_ACTIVE_MS = 2 * 60 * 1000;

export interface TenantAuthContext {
  tenantId: number;
  identityKey: string;
}

@Injectable()
export class WaitingRoomService {
  private readonly logger = new Logger(WaitingRoomService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsBus: EventsBusService,
    private readonly blockService: BlockService,
    private readonly signatureService: SignatureService
  ) {}

  async resolveTenantContext(signatureKey: string, sessionId?: string): Promise<TenantAuthContext> {
    if (!signatureKey || typeof signatureKey !== 'string') {
      throw new UnauthorizedException('Assinatura ausente');
    }

    const signature = await this.prisma.signature.findUnique({
      where: { key: signatureKey },
      select: { id: true, token: true, tenantId: true, kind: true, revokedAt: true },
    });

    if (!signature || signature.kind !== 'tenant') {
      throw new UnauthorizedException('Assinatura inválida');
    }

    if (signature.revokedAt) {
      throw new UnauthorizedException('Assinatura revogada');
    }

    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(signature.token, envs.JWT_SECRET) as jwt.JwtPayload;
    } catch (err) {
      this.logger.warn(`Falha ao decodificar token da assinatura de tenant ${signature.id}: ${(err as Error).message}`);
      throw new UnauthorizedException('Assinatura inválida');
    }

    const tenantId = typeof decoded.tenantId === 'number' ? decoded.tenantId : Number((decoded as { tenantId?: string | number }).tenantId);
    if (!Number.isFinite(tenantId) || tenantId !== signature.tenantId) {
      throw new UnauthorizedException('Assinatura não corresponde ao tenant');
    }

    return {
      tenantId,
      identityKey: sessionId && typeof sessionId === 'string' ? sessionId : 'anonymous',
    };
  }

  async listActiveGroups(tenantId: number) {
    const threshold = new Date(Date.now() - PRESENCE_ACTIVE_MS);
    const overseerGroups = await this.prisma.waitingRoomPresence.findMany({
      where: { tenantId, kind: 'overseer', lastSeenAt: { gte: threshold } },
      select: { groupId: true },
      distinct: ['groupId'],
    });
    const groupIds = overseerGroups.map(row => row.groupId);
    if (groupIds.length === 0) return [];

    const [groups, publisherCounts] = await Promise.all([
      this.prisma.group.findMany({
        where: { tenantId, id: { in: groupIds } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.waitingRoomPresence.groupBy({
        by: ['groupId'],
        where: { tenantId, kind: 'publisher', lastSeenAt: { gte: threshold }, groupId: { in: groupIds } },
        _count: { _all: true },
      }),
    ]);

    const counts = new Map(publisherCounts.map(row => [row.groupId, row._count._all]));
    return groups.map(group => ({
      id: group.id,
      name: group.name,
      publishers: counts.get(group.id) ?? 0,
    }));
  }

  async joinRoom({ groupId, tenantId, identityKey, body }: { groupId: string; tenantId: number; identityKey: string; body: JoinRoomDto }) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, tenantId },
      select: { id: true },
    });
    if (!group) throw new NotFoundException('Grupo não encontrado');

    if (body.territoryId !== undefined && body.territoryId !== null) {
      if (body.round === undefined || body.round === null) {
        throw new BadRequestException('O campo "round" é obrigatório para dirigentes');
      }
      const territory = await this.prisma.territory.findFirst({
        where: { id: body.territoryId, tenantId },
        select: { id: true },
      });
      if (!territory) throw new NotFoundException('Território não encontrado');

      await this.prisma.$transaction(async tx => {
        await tx.waitingRoomPresence.upsert({
          where: { groupId_identityKey: { groupId, identityKey } },
          create: {
            tenantId,
            groupId,
            identityKey,
            kind: 'overseer',
            territoryId: body.territoryId,
            round: body.round,
          },
          update: {
            kind: 'overseer',
            territoryId: body.territoryId,
            round: body.round,
            lastSeenAt: new Date(),
          },
        });
        await this.eventsBus.publishWaitingRoomChanged(tx, { groupId, type: 'presence' });
      });

      return { role: 'overseer', groupId, territoryId: body.territoryId, round: body.round };
    }

    const profile = await this.prisma.$transaction(async tx => {
      const publisher = await tx.publisher.upsert({
        where: { tenantId_identityKey: { tenantId, identityKey } },
        create: {
          tenantId,
          identityKey,
          firstName: body.firstName ?? '',
          lastName: body.lastName ?? '',
          phoneLast4: body.phoneLast4 ?? '',
        },
        update: {
          firstName: body.firstName ?? undefined,
          lastName: body.lastName ?? undefined,
          phoneLast4: body.phoneLast4 ?? undefined,
        },
        select: { firstName: true, lastName: true, phoneLast4: true },
      });

      const displayName = [body.firstName, body.lastName].filter(Boolean).join(' ') || undefined;
      await tx.waitingRoomPresence.upsert({
        where: { groupId_identityKey: { groupId, identityKey } },
        create: { tenantId, groupId, identityKey, kind: 'publisher', displayName },
        update: { kind: 'publisher', displayName: displayName ?? undefined, lastSeenAt: new Date() },
      });
      await this.eventsBus.publishWaitingRoomChanged(tx, { groupId, type: 'presence' });
      return publisher;
    });

    return {
      role: 'publisher',
      groupId,
      profile: { ...profile, identityKey },
    };
  }

  async heartbeat({ groupId, tenantId, identityKey }: { groupId: string; tenantId: number; identityKey: string }): Promise<{ ok: boolean }> {
    await this.prisma.waitingRoomPresence.updateMany({
      where: { groupId, tenantId, identityKey },
      data: { lastSeenAt: new Date() },
    });
    return { ok: true };
  }

  async getRoom({ groupId, tenantId, identityKey }: { groupId: string; tenantId: number; identityKey: string }) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, tenantId },
      select: { id: true, name: true },
    });
    if (!group) throw new NotFoundException('Grupo não encontrado');

    const presence = await this.prisma.waitingRoomPresence.findUnique({
      where: { groupId_identityKey: { groupId, identityKey } },
    });
    if (!presence) throw new NotFoundException('Presença não encontrada');

    if (presence.kind === 'overseer') {
      if (!presence.territoryId) throw new BadRequestException('Dirigente sem território vinculado');
      const [publishers, assignments, blocks] = await Promise.all([
        this.getPublishersPayload(groupId),
        this.getAssignmentsPayload(groupId),
        this.blockService.getTerritoryBlocks(presence.territoryId, tenantId).then(rows => rows.map(row => ({ id: row.id, name: row.name }))),
      ]);
      return {
        role: 'overseer',
        group: { id: group.id, name: group.name },
        territoryId: presence.territoryId,
        round: presence.round,
        publishers,
        assignments,
        blocks,
      };
    }

    const publisher = await this.prisma.publisher.findFirst({
      where: { tenantId, identityKey },
      select: { firstName: true, lastName: true, phoneLast4: true },
    });
    const assignments = await this.getPublisherAssignments(groupId, identityKey);
    return {
      role: 'publisher',
      group: { id: group.id, name: group.name },
      profile: publisher ?? { firstName: null, lastName: null, phoneLast4: null },
      assignments,
    };
  }

  async createAssignment({ groupId, tenantId, body }: { groupId: string; tenantId: number; body: CreateAssignmentDto }) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, tenantId },
      select: { id: true },
    });
    if (!group) throw new NotFoundException('Grupo não encontrado');

    const territory = await this.prisma.territory.findFirst({
      where: { id: body.territoryId, tenantId },
      select: { id: true },
    });
    if (!territory) throw new NotFoundException('Território não encontrado');

    const territoryBlock = await this.prisma.territory_block.findUnique({
      where: { territoryId_blockId: { territoryId: body.territoryId, blockId: body.blockId } },
      select: { id: true, tenantId: true },
    });
    if (!territoryBlock || territoryBlock.tenantId !== tenantId) {
      throw new NotFoundException('Bloco não encontrado');
    }

    try {
      return await this.prisma.$transaction(async tx => {
        const assignment = await tx.assignment.create({
          data: {
            tenantId,
            publisherId: body.publisherId,
            groupId,
            blockId: body.blockId,
            territoryId: body.territoryId,
            round: body.round,
          },
          select: { id: true, publisherId: true, blockId: true, territoryId: true, round: true },
        });
        await this.eventsBus.publishWaitingRoomChanged(tx, { groupId, type: 'assignments' });
        return assignment;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Atribuição já existe para este publicador e quadra');
      }
      throw error;
    }
  }

  async removeAssignment({ groupId, tenantId, body }: { groupId: string; tenantId: number; body: DeleteAssignmentDto }): Promise<{ deleted: boolean }> {
    await this.prisma.$transaction(async tx => {
      await tx.assignment.deleteMany({
        where: { tenantId, groupId, publisherId: body.publisherId, blockId: body.blockId },
      });
      await this.eventsBus.publishWaitingRoomChanged(tx, { groupId, type: 'assignments' });
    });
    return { deleted: true };
  }

  async generateBlockSignature({
    groupId,
    tenantId,
    identityKey,
    blockId,
  }: {
    groupId: string;
    tenantId: number;
    identityKey: string;
    blockId: number;
  }): Promise<{ key: string }> {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, tenantId },
      select: { id: true },
    });
    if (!group) throw new NotFoundException('Grupo não encontrado');

    const presence = await this.prisma.waitingRoomPresence.findUnique({
      where: { groupId_identityKey: { groupId, identityKey } },
    });
    if (!presence) throw new NotFoundException('Presença não encontrada');

    const assignment =
      presence.kind === 'overseer'
        ? presence.territoryId
          ? await this.prisma.assignment.findFirst({
              where: { tenantId, groupId, blockId, territoryId: presence.territoryId },
            })
          : null
        : await this.prisma.assignment.findFirst({
            where: { tenantId, groupId, blockId, publisherId: identityKey },
          });

    if (!assignment) {
      throw new ForbiddenException('Sem permissão para compartilhar esta quadra');
    }

    return this.signatureService.generateBlockSignatureForShare({
      territoryId: assignment.territoryId,
      blockId: assignment.blockId,
      tenantId,
      round: assignment.round,
    });
  }

  async getPublishersPayload(groupId: string) {
    const presences = await this.prisma.waitingRoomPresence.findMany({
      where: { groupId, kind: 'publisher' },
      orderBy: { joinedAt: 'asc' },
    });
    if (presences.length === 0) return [];

    const identityKeys = presences.map(row => row.identityKey);
    const publishers = await this.prisma.publisher.findMany({
      where: { identityKey: { in: identityKeys } },
      select: { identityKey: true, tenantId: true, firstName: true, lastName: true, phoneLast4: true },
    });
    const byKey = new Map(publishers.map(row => [`${row.tenantId}:${row.identityKey}`, row]));

    return presences.map(row => {
      const publisher = byKey.get(`${row.tenantId}:${row.identityKey}`);
      return {
        identityKey: row.identityKey,
        firstName: publisher?.firstName ?? null,
        lastName: publisher?.lastName ?? null,
        phoneLast4: publisher?.phoneLast4 ?? null,
        joinedAt: row.joinedAt,
      };
    });
  }

  async getAssignmentsPayload(groupId: string) {
    const assignments = await this.prisma.assignment.findMany({
      where: { groupId },
      orderBy: { createdAt: 'asc' },
    });
    if (assignments.length === 0) return [];

    const [publishers, blocks] = await Promise.all([
      this.prisma.publisher.findMany({
        where: { identityKey: { in: assignments.map(row => row.publisherId) } },
        select: { identityKey: true, tenantId: true, firstName: true, lastName: true },
      }),
      this.prisma.block.findMany({
        where: { id: { in: assignments.map(row => row.blockId) } },
        select: { id: true, name: true },
      }),
    ]);

    const publisherByKey = new Map(publishers.map(row => [`${row.tenantId}:${row.identityKey}`, row]));
    const blockById = new Map(blocks.map(row => [row.id, row]));

    return assignments.map(row => {
      const publisher = publisherByKey.get(`${row.tenantId}:${row.publisherId}`);
      return {
        id: row.id,
        publisherId: row.publisherId,
        firstName: publisher?.firstName ?? null,
        lastName: publisher?.lastName ?? null,
        blockId: row.blockId,
        blockName: blockById.get(row.blockId)?.name ?? null,
        territoryId: row.territoryId,
        round: row.round,
      };
    });
  }

  private async getPublisherAssignments(groupId: string, identityKey: string) {
    const assignments = await this.prisma.assignment.findMany({
      where: { groupId, publisherId: identityKey },
      orderBy: { createdAt: 'asc' },
    });
    if (assignments.length === 0) return [];

    const blocks = await this.prisma.block.findMany({
      where: { id: { in: assignments.map(row => row.blockId) } },
      select: { id: true, name: true },
    });
    const blockById = new Map(blocks.map(row => [row.id, row]));

    return assignments.map(row => ({
      id: row.id,
      blockId: row.blockId,
      blockName: blockById.get(row.blockId)?.name ?? null,
      territoryId: row.territoryId,
      round: row.round,
    }));
  }
}
