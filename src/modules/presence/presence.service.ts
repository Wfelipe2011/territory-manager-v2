import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infra/prisma/prisma.service';

export interface JoinPresenceInput {
  streetKey: string;
  identityKey: string;
  connectionId: string;
  instanceId: string;
}

export interface PresenceRow {
  presenceId: string;
  streetKey: string;
  userId: number | null;
  identityKey: string;
  connectionId: string;
  instanceId: string;
  connectedAt: Date;
  lastSeenAt: Date;
}

const HEARTBEAT_THRESHOLD_SECONDS = 30;
const CLEANUP_THRESHOLD_SECONDS = 120;

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async join(input: JoinPresenceInput, tx?: Prisma.TransactionClient): Promise<PresenceRow> {
    const client = tx ?? this.prisma;
    const presence = await client.street_presence.upsert({
      where: { connectionId: input.connectionId },
      create: {
        presenceId: crypto.randomUUID(),
        streetKey: input.streetKey,
        userId: null,
        identityKey: input.identityKey,
        connectionId: input.connectionId,
        instanceId: input.instanceId,
      },
      update: {
        streetKey: input.streetKey,
        identityKey: input.identityKey,
        instanceId: input.instanceId,
        lastSeenAt: new Date(),
      },
    });
    return this.toRow(presence);
  }

  async heartbeat(connectionId: string): Promise<boolean> {
    const now = new Date();
    const { count } = await this.prisma.street_presence.updateMany({
      where: { connectionId },
      data: { lastSeenAt: now },
    });
    return count > 0;
  }

  async leave(connectionId: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    const client = tx ?? this.prisma;
    const { count } = await client.street_presence.deleteMany({
      where: { connectionId },
    });
    return count > 0;
  }

  async getCount(streetKey: string): Promise<number> {
    const threshold = new Date(Date.now() - HEARTBEAT_THRESHOLD_SECONDS * 1000);
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(DISTINCT identity_key)::int AS count
        FROM street_presence
        WHERE street_key = ${streetKey}
          AND last_seen_at >= ${threshold}
      `
    );
    return Number(rows[0]?.count ?? 0);
  }

  async getTotalActiveUsers(): Promise<number> {
    const threshold = new Date(Date.now() - HEARTBEAT_THRESHOLD_SECONDS * 1000);
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(DISTINCT identity_key)::int AS count
        FROM street_presence
        WHERE last_seen_at >= ${threshold}
      `
    );
    return Number(rows[0]?.count ?? 0);
  }

  async listByStreetKey(streetKey: string): Promise<PresenceRow[]> {
    const threshold = new Date(Date.now() - HEARTBEAT_THRESHOLD_SECONDS * 1000);
    const rows = await this.prisma.street_presence.findMany({
      where: { streetKey, lastSeenAt: { gte: threshold } },
      orderBy: { connectedAt: 'asc' },
    });
    return rows.map(r => this.toRow(r));
  }

  async cleanupExpired(): Promise<number> {
    const threshold = new Date(Date.now() - CLEANUP_THRESHOLD_SECONDS * 1000);
    const { count } = await this.prisma.street_presence.deleteMany({
      where: { lastSeenAt: { lt: threshold } },
    });
    if (count > 0) {
      this.logger.log(`Limpeza de presença removeu ${count} registros stale (threshold=${CLEANUP_THRESHOLD_SECONDS}s)`);
    }
    return count;
  }

  private toRow(row: {
    presenceId: string;
    streetKey: string;
    userId: number | null;
    identityKey: string;
    connectionId: string;
    instanceId: string;
    connectedAt: Date;
    lastSeenAt: Date;
  }): PresenceRow {
    return {
      presenceId: row.presenceId,
      streetKey: row.streetKey,
      userId: row.userId,
      identityKey: row.identityKey,
      connectionId: row.connectionId,
      instanceId: row.instanceId,
      connectedAt: row.connectedAt,
      lastSeenAt: row.lastSeenAt,
    };
  }
}
