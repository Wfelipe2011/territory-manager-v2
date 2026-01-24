import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { HealthService } from './health.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, HealthService],
  exports: [HealthService],
})
export class DashboardModule { }
