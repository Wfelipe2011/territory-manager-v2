import { Module, forwardRef } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { HealthService } from './health.service';
import { AuthModule } from '../auth/auth.module';
import { ConcurrencyService } from './concurrency.service';
import { UsageService } from './usage.service';

@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
   providers: [DashboardService, HealthService, ConcurrencyService, UsageService],
  exports: [HealthService],
})
export class DashboardModule { }
