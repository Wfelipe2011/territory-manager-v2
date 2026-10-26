import { Controller, Get, MiddlewareConsumer, Module, NestModule, Query } from '@nestjs/common';
import { Roles } from '../../decorators/roles.decorator';
import { Role } from '../../enum/role.enum';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { ApiMetrics, MetricsMiddleware } from './metrics.middleware';
import { MonitoringService } from './monitoring.service';

@Controller({ path: 'dashboard/monitoring', version: '1' })
@Roles(Role.SUPER_ADMIN)
class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}
  @Get()
  report(@Query('period') period?: string) { return this.monitoring.report(period); }
}

@Module({ imports: [PrismaModule], controllers: [MonitoringController], providers: [ApiMetrics, MetricsMiddleware, MonitoringService], exports: [ApiMetrics, MonitoringService] })
export class MonitoringModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(MetricsMiddleware).forRoutes('*'); }
}
