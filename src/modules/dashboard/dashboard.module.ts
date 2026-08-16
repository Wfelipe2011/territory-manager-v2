import { Module, forwardRef } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../presence/presence.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { HealthService } from './health.service';

@Module({
  imports: [AuthModule, PresenceModule],
  controllers: [DashboardController],
  providers: [DashboardService, HealthService],
  exports: [HealthService],
})
export class DashboardModule {}
