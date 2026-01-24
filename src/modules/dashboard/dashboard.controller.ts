import { Body, Controller, Get, Post, Render, Res, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { VERSION } from 'src/enum/version.enum';
import { DashboardService } from './dashboard.service';
import { HealthService } from './health.service';
import { Public } from 'src/decorators/public.decorator';
import { RequestUser } from 'src/interfaces/RequestUser';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { AuthService } from '../auth/auth.service';
import { Response } from 'express';

@ApiTags('Dashboard')
@Controller({
  version: VERSION.V1,
  path: 'dashboard',
})
export class DashboardController {
  constructor(
    readonly dashBoardService: DashboardService,
    private readonly healthService: HealthService,
    private readonly authService: AuthService
  ) { }

  @Public()
  @Get('login')
  @Render('login')
  loginPage() {
    return { layout: false };
  }

  @Public()
  @Post('login')
  async login(@Body() body: any, @Res() res: Response) {
    try {
      const { token } = await this.authService.login(body.email, body.password);
      res.cookie('access_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 1 dia
      });
      return res.redirect('/v1/dashboard');
    } catch (error) {
      return res.render('login', { error: 'Credenciais inválidas', layout: false });
    }
  }

  @Get('logout')
  logout(@Res() res: Response) {
    res.clearCookie('access_token');
    return res.redirect('/v1/dashboard/login');
  }

  @Get()
  @Render('dashboard')
  async root(@Request() req: RequestUser) {
    const health = await this.healthService.getHealthData();

    // Formatação de Uptime para o SSR inicial
    const uptime = health.system_info.uptime_seconds;
    const d = Math.floor(uptime / (3600 * 24));
    const h = Math.floor(uptime % (3600 * 24) / 3600);
    const m = Math.floor(uptime % 3600 / 60);
    const s = Math.floor(uptime % 60);

    const isSuperAdmin = req.user.roles.includes(Role.SUPER_ADMIN);

    return {
      health,
      user: req.user,
      isSuperAdmin,
      activePage: 'dashboard',
      lastUpdateTime: new Date().toLocaleTimeString('pt-BR'),
      dbPercent: ((health.database_info.active / health.database_info.max_connections) * 100).toFixed(1),
      uptimeFormatted: `${d}d ${h}h ${m}m ${s}s`,
    };
  }

  @Roles(Role.SUPER_ADMIN)
  @Get('tenants')
  @Render('tenants')
  async tenantsPage(@Request() req: RequestUser) {
    const tenants = await this.authService.listAllTenants();
    return {
      tenants,
      user: req.user,
      isSuperAdmin: true,
      activePage: 'tenants',
    };
  }

  @Roles(Role.SUPER_ADMIN)
  @Post('switch-tenant')
  async switchTenant(@Body('tenantId') tenantId: string, @Request() req: RequestUser, @Res() res: Response) {
    const { token } = await this.authService.switchTenant(req.user.userId, +tenantId);
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
    });
    return res.redirect('/v1/dashboard');
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
