import { Controller, Get, Render } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { VERSION } from 'src/enum/version.enum';
import { DashboardService } from './dashboard.service';
import { HealthService } from './health.service';
import { Public } from 'src/decorators/public.decorator';
import { RequestUser } from 'src/interfaces/RequestUser';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { Request } from '@nestjs/common';

@ApiTags('Dashboard')
@Controller({
  version: VERSION.V1,
  path: 'dashboard',
})
export class DashboardController {
  constructor(
    readonly dashBoardService: DashboardService,
    private readonly healthService: HealthService
  ) { }

  @Public()
  @Get()
  @Render('dashboard')
  async root() {
    const health = await this.healthService.getHealthData();

    // Formatação de Uptime para o SSR inicial
    const uptime = health.system_info.uptime_seconds;
    const d = Math.floor(uptime / (3600 * 24));
    const h = Math.floor(uptime % (3600 * 24) / 3600);
    const m = Math.floor(uptime % 3600 / 60);
    const s = Math.floor(uptime % 60);

    return {
      health,
      lastUpdateTime: new Date().toLocaleTimeString('pt-BR'),
      dbPercent: ((health.database_info.active / health.database_info.max_connections) * 100).toFixed(1),
      uptimeFormatted: `${d}d ${h}h ${m}m ${s}s`,
    };
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Busca todas as casas marcadas' })
  @Get('marked-houses')
  @Roles(Role.ADMIN)
  async findAll(@Request() req: RequestUser) {
    return this.dashBoardService.findMarkedHouses(req.user.tenantId);
  }

  @ApiResponse({ status: 200 })
  @ApiOperation({ summary: 'Busca os detalhes do território' })
  @Get('territory-details')
  @Roles(Role.ADMIN)
  async territoryDetails(@Request() req: RequestUser) {
    return this.dashBoardService.territoryDetails(req.user.tenantId);
  }
}
