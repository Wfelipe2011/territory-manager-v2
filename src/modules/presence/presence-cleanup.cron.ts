import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PresenceService } from './presence.service';

@Injectable()
export class PresenceCleanupCron {
  private readonly logger = new Logger(PresenceCleanupCron.name);

  constructor(private readonly presenceService: PresenceService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleCleanup(): Promise<void> {
    try {
      const removed = await this.presenceService.cleanupExpired();
      if (removed > 0) {
        this.logger.log(`Cleanup de presença removeu ${removed} conexões expiradas`);
      }
    } catch (err) {
      this.logger.error(`Falha no cleanup de presença: ${(err as Error).message}`);
    }
  }
}
