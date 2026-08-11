import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const PGBOSS_NOTIFY_CHANNELS = {
  STREET_CHANGED: 'street.changed',
  USER_JOINED_STREET: 'USER_JOINED_STREET',
  USER_LEFT_STREET: 'USER_LEFT_STREET',
} as const;

export const PGBOSS_QUEUE_NAMES = Object.values(PGBOSS_NOTIFY_CHANNELS);

const EXPIRE_SECONDS = 60 * 15;
const KEEP_MINUTES = 60 * 24 * 14;

export interface StreetChangedPayload {
  streetKey: string;
  reason: 'HOUSE_UPDATED' | 'ROUND_STARTED' | 'ROUND_ENDED';
  territoryId?: number;
  blockId?: number;
  addressId?: number;
  round?: number;
}

export interface PresencePayload {
  streetKey: string;
  identityKey: string;
  presenceId: string;
}

@Injectable()
export class EventsBusService {
  private readonly logger = new Logger(EventsBusService.name);

  async publishStreetChanged(
    tx: Prisma.TransactionClient,
    payload: StreetChangedPayload,
  ): Promise<void> {
    const data = JSON.stringify(payload);
    try {
      await tx.$executeRaw`
        SELECT pg_notify(
          ${PGBOSS_NOTIFY_CHANNELS.STREET_CHANGED},
          ${data}::text
        )
      `;
    } catch (err) {
      this.logger.error(`Falha publicando street.changed (${payload.streetKey}): ${(err as Error).message}`);
      throw err;
    }
  }

  async publishUserJoined(
    tx: Prisma.TransactionClient,
    payload: PresencePayload,
  ): Promise<void> {
    const data = JSON.stringify(payload);
    try {
      await tx.$executeRaw`
        SELECT pg_notify(
          ${PGBOSS_NOTIFY_CHANNELS.USER_JOINED_STREET},
          ${data}::text
        )
      `;
    } catch (err) {
      this.logger.error(`Falha publicando USER_JOINED_STREET (${payload.streetKey}): ${(err as Error).message}`);
      throw err;
    }
  }

  async publishUserLeft(
    tx: Prisma.TransactionClient,
    payload: PresencePayload,
  ): Promise<void> {
    const data = JSON.stringify(payload);
    try {
      await tx.$executeRaw`
        SELECT pg_notify(
          ${PGBOSS_NOTIFY_CHANNELS.USER_LEFT_STREET},
          ${data}::text
        )
      `;
    } catch (err) {
      this.logger.error(`Falha publicando USER_LEFT_STREET (${payload.streetKey}): ${(err as Error).message}`);
      throw err;
    }
  }
}
