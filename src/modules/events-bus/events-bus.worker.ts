import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client, ClientConfig } from 'pg';

import { PGBOSS_NOTIFY_CHANNELS } from '../../infra/pgboss/pgboss.service';
import { PresenceService } from '../presence/presence.service';
import { SseManager } from '../realtime/sse.manager';
import { WaitingRoomService } from '../waiting-room/waiting-room.service';

interface StreetChangedPayload {
  streetKey: string;
  reason: 'HOUSE_UPDATED' | 'ROUND_STARTED' | 'ROUND_ENDED';
  territoryId?: number;
  blockId?: number;
  addressId?: number;
  round?: number;
}

interface PresencePayload {
  streetKey: string;
  identityKey: string;
  presenceId: string;
}

interface WaitingRoomChangedPayload {
  groupId: string;
  type: 'presence' | 'assignments';
}

@Injectable()
export class EventsBusWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsBusWorker.name);
  private client: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;

  constructor(
    private readonly sseManager: SseManager,
    private readonly presenceService: PresenceService,
    private readonly waitingRoomService: WaitingRoomService
  ) {}

  async onModuleInit(): Promise<void> {
    this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.isDestroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try {
        await this.client.end();
      } catch (err) {
        this.logger.warn(`Erro fechando conexão LISTEN: ${(err as Error).message}`);
      }
      this.client = null;
    }
  }

  private connect(): void {
    const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
      this.logger.error('DIRECT_URL/DATABASE_URL ausente — listener LISTEN/NOTIFY não será iniciado');
      return;
    }

    const config: ClientConfig = { connectionString };
    const client = new Client(config);
    this.client = client;

    const onNotification = (raw: { channel: string; payload?: string }) => {
      const channel = raw.channel;
      const payload = raw.payload ?? '{}';
      try {
        const parsed = JSON.parse(payload);
        switch (channel) {
          case PGBOSS_NOTIFY_CHANNELS.STREET_CHANGED:
            void this.handleStreetChanged(parsed as StreetChangedPayload);
            return;
          case PGBOSS_NOTIFY_CHANNELS.USER_JOINED_STREET:
            void this.handleUserJoined(parsed as PresencePayload);
            return;
          case PGBOSS_NOTIFY_CHANNELS.USER_LEFT_STREET:
            void this.handleUserLeft(parsed as PresencePayload);
            return;
          case PGBOSS_NOTIFY_CHANNELS.WAITING_ROOM_CHANGED:
            void this.handleWaitingRoomChanged(parsed as WaitingRoomChangedPayload);
        }
      } catch (err) {
        this.logger.warn(`Falha parseando payload de ${channel}: ${(err as Error).message}`);
      }
    };

    client.on('notification', onNotification);
    client.on('error', (err: Error) => {
      this.logger.warn(`Erro no cliente LISTEN: ${err.message}`);
    });
    client.on('end', () => {
      if (this.isDestroyed) return;
      this.logger.warn('Conexão LISTEN encerrada; reconectando em 2s');
      this.client = null;
      this.scheduleReconnect();
    });

    void client
      .connect()
      .then(async () => {
        if (this.isDestroyed) return;
        await client.query(`LISTEN "${PGBOSS_NOTIFY_CHANNELS.STREET_CHANGED}"`);
        await client.query(`LISTEN "${PGBOSS_NOTIFY_CHANNELS.USER_JOINED_STREET}"`);
        await client.query(`LISTEN "${PGBOSS_NOTIFY_CHANNELS.USER_LEFT_STREET}"`);
        await client.query(`LISTEN "${PGBOSS_NOTIFY_CHANNELS.WAITING_ROOM_CHANGED}"`);
        this.logger.log(`Listener LISTEN/NOTIFY ativo nos canais: ${Object.values(PGBOSS_NOTIFY_CHANNELS).join(', ')}`);
      })
      .catch((err: Error) => {
        if (this.isDestroyed) return;
        this.logger.error(`Falha conectando listener LISTEN: ${err.message}`);
        this.scheduleReconnect();
      });
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  private async handleStreetChanged(payload: StreetChangedPayload): Promise<void> {
    if (!payload?.streetKey) {
      this.logger.warn('street.changed sem streetKey — descartando');
      return;
    }
    this.sseManager.broadcastToRoom(payload.streetKey, {
      type: 'street_changed',
      data: { streetKey: payload.streetKey, reason: payload.reason },
    });
  }

  private async handleUserJoined(payload: PresencePayload): Promise<void> {
    if (!payload?.streetKey) return;
    try {
      const userCount = await this.presenceService.getCount(payload.streetKey);
      this.sseManager.emitPresenceChanged(payload.streetKey, userCount);
    } catch (err) {
      this.logger.warn(`Falha processando USER_JOINED_STREET (${payload.streetKey}): ${(err as Error).message}`);
    }
  }

  private async handleUserLeft(payload: PresencePayload): Promise<void> {
    if (!payload?.streetKey) return;
    try {
      const userCount = await this.presenceService.getCount(payload.streetKey);
      this.sseManager.emitPresenceChanged(payload.streetKey, userCount);
    } catch (err) {
      this.logger.warn(`Falha processando USER_LEFT_STREET (${payload.streetKey}): ${(err as Error).message}`);
    }
  }

  private async handleWaitingRoomChanged(payload: WaitingRoomChangedPayload): Promise<void> {
    if (!payload?.groupId) {
      this.logger.warn('waiting_room.changed sem groupId — descartando');
      return;
    }
    try {
      const roomKey = `waiting-room:${payload.groupId}`;
      if (payload.type === 'presence') {
        const publishers = await this.waitingRoomService.getPublishersPayload(payload.groupId);
        this.sseManager.broadcastToRoom(roomKey, { type: 'presence_changed', data: publishers });
      } else {
        const assignments = await this.waitingRoomService.getAssignmentsPayload(payload.groupId);
        this.sseManager.broadcastToRoom(roomKey, { type: 'assignments_changed', data: assignments });
      }
    } catch (err) {
      this.logger.warn(`Falha processando waiting_room.changed (${payload.groupId}): ${(err as Error).message}`);
    }
  }
}
