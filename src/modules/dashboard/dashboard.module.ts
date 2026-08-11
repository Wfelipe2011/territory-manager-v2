import { Module, forwardRef } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { HealthService } from './health.service';
import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [AuthModule, PresenceModule],
  controllers: [DashboardController],
  providers: [DashboardService, HealthService],
  exports: [HealthService],
})
export class DashboardModule { }
