import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/infra/prisma/prisma.service';

import { EventsBusService } from '../events-bus/events-bus.service';

const PRESENCE_STALE_MS = 2 * 60 * 1000;

@Injectable()
export class WaitingRoomCleanupCron {
  private readonly logger = new Logger(WaitingRoomCleanupCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsBus: EventsBusService
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCleanup(): Promise<void> {
    try {
      const threshold = new Date(Date.now() - PRESENCE_STALE_MS);
      const staleGroups = await this.prisma.waitingRoomPresence.findMany({
        where: { lastSeenAt: { lt: threshold } },
        select: { groupId: true },
        distinct: ['groupId'],
      });

      const { count } = await this.prisma.waitingRoomPresence.deleteMany({
        where: { lastSeenAt: { lt: threshold } },
      });

      if (count > 0) {
        this.logger.log(`Cleanup da sala de espera removeu ${count} presenças stale`);
        for (const row of staleGroups) {
          await this.eventsBus.publishWaitingRoomChanged(this.prisma, {
            groupId: row.groupId,
            type: 'presence',
          });
        }
      }
    } catch (err) {
      this.logger.error(`Falha no cleanup da sala de espera: ${(err as Error).message}`);
    }
  }
}
