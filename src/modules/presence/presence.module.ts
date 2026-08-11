import { Module } from '@nestjs/common';

import { PresenceCleanupCron } from './presence-cleanup.cron';
import { PresenceService } from './presence.service';

@Module({
  providers: [PresenceService, PresenceCleanupCron],
  exports: [PresenceService],
})
export class PresenceModule {}
