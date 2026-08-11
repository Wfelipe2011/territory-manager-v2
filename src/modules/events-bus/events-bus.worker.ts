import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { Client, ClientConfig } from 'pg';

import { PGBOSS_NOTIFY_CHANNELS } from '../../infra/pgboss/pgboss.service';
import { PresenceService } from '../presence/presence.service';
import { SseManager } from '../realtime/sse.manager';

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

@Injectable()
export class EventsBusWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsBusWorker.name);
  private client: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sseManager: SseManager,
    private readonly presenceService: PresenceService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connect();
  }

  async onModuleDestroy(): Promise<void> {
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
      this.logger.warn('Conexão LISTEN encerrada; reconectando em 2s');
      this.client = null;
      this.scheduleReconnect();
    });

    void client
      .connect()
      .then(async () => {
        await client.query(`LISTEN "${PGBOSS_NOTIFY_CHANNELS.STREET_CHANGED}"`);
        await client.query(`LISTEN "${PGBOSS_NOTIFY_CHANNELS.USER_JOINED_STREET}"`);
        await client.query(`LISTEN "${PGBOSS_NOTIFY_CHANNELS.USER_LEFT_STREET}"`);
        this.logger.log(
          `Listener LISTEN/NOTIFY ativo nos canais: ${Object.values(PGBOSS_NOTIFY_CHANNELS).join(', ')}`,
        );
      })
      .catch((err: Error) => {
        this.logger.error(`Falha conectando listener LISTEN: ${err.message}`);
        this.scheduleReconnect();
      });
  }

  private scheduleReconnect(): void {
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
    this.sseManager.broadcastToStreet(payload.streetKey, {
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
}
