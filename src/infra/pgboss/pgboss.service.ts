import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import PgBoss from 'pg-boss';

export const PGBOSS_QUEUES = {
  STREET_CHANGED: 'street.changed',
  USER_JOINED_STREET: 'USER_JOINED_STREET',
  USER_LEFT_STREET: 'USER_LEFT_STREET',
  WAITING_ROOM_CHANGED: 'waiting_room.changed',
} as const;

export const PGBOSS_NOTIFY_CHANNELS = PGBOSS_QUEUES;

export const PGBOSS_QUEUE_NAMES = Object.values(PGBOSS_QUEUES);

@Injectable()
export class PgbossService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgbossService.name);
  private instance: PgBoss | null = null;
  private started = false;

  async onModuleInit(): Promise<void> {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      this.logger.error('DIRECT_URL e DATABASE_URL ausentes — pg-boss não será inicializado.');
      return;
    }

    const schema = process.env.PGBOSS_SCHEMA || 'pgboss';
    const instanceId = process.env.INSTANCE_ID || process.env.HOSTNAME || 'local';

    this.instance = new PgBoss({
      connectionString,
      schema,
      application_name: `territory-manager-${instanceId}`,
      archiveCompletedAfterSeconds: 60 * 60 * 24,
      archiveFailedAfterSeconds: 60 * 60 * 24 * 7,
    });

    this.instance.on('error', (err: Error) => {
      this.logger.error(`pg-boss error: ${err.message}`);
    });

    try {
      await this.instance.start();
      this.started = true;
      this.logger.log(`pg-boss inicializado (schema=${schema}, instance=${instanceId})`);

      const queueOptions = {
        retryLimit: 5,
        retryDelay: 5,
        retryBackoff: true,
        expireInSeconds: 60 * 15,
      };

      for (const queueName of PGBOSS_QUEUE_NAMES) {
        try {
          await this.instance.createQueue(queueName, { name: queueName, ...queueOptions });
          this.logger.log(`Fila '${queueName}' pronta.`);
        } catch (err) {
          this.logger.warn(`Falha ao criar fila '${queueName}': ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.error(`Falha ao inicializar pg-boss: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.instance && this.started) {
      try {
        await this.instance.stop({ graceful: true, timeout: 10_000 });
        this.logger.log('pg-boss parado graciosamente.');
      } catch (err) {
        this.logger.warn(`Falha parando pg-boss: ${(err as Error).message}`);
      }
    }
  }

  get boss(): PgBoss {
    if (!this.instance || !this.started) {
      throw new Error('pg-boss não está inicializado');
    }
    return this.instance;
  }

  isReady(): boolean {
    return this.started;
  }

  async getQueueSize(name: string): Promise<number> {
    if (!this.instance || !this.started) return 0;
    try {
      return await this.instance.getQueueSize(name);
    } catch (err) {
      this.logger.warn(`getQueueSize(${name}) falhou: ${(err as Error).message}`);
      return 0;
    }
  }
}
