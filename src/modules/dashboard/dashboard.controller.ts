import { Body, Controller, Get, Post, Query, Render, Res, Request } from '@nestjs/common';
import { UsageService } from './usage.service';
import { ConcurrencyParams } from './concurrency.service';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { VERSION } from 'src/enum/version.enum';
import { DashboardService } from './dashboard.service';
import { Public } from 'src/decorators/public.decorator';
import { RequestUser } from 'src/interfaces/RequestUser';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { AuthService } from '../auth/auth.service';
import { Response } from 'express';
import * as jwt from 'jsonwebtoken';

@ApiTags('Dashboard')
@Controller({
  version: VERSION.V1,
  path: 'dashboard',
})
@Roles(Role.SUPER_ADMIN)
export class DashboardController {
  constructor(
    readonly dashBoardService: DashboardService,
    private readonly authService: AuthService,
    private readonly usageService: UsageService
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

      // Validação de regra: Somente Super Admin pode acessar o dashboard
      const payload = jwt.decode(token) as any;
      if (!payload || !payload?.roles?.includes(Role.SUPER_ADMIN)) {
        return res.render('login', {
          error: 'Acesso restrito a Super Administradores',
          layout: false
        });
      }

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

  @Public()
  @Get('logout')
  logout(@Res() res: Response) {
    res.clearCookie('access_token');
    return res.redirect('/v1/dashboard/login');
  }

  @Get()
  @Render('dashboard')
  async root(@Request() req: RequestUser) {
    return {
      user: req.user,
      isSuperAdmin: true,
      activePage: 'dashboard',
    };
  }

  @Get('usage')
  usage(@Query() params: ConcurrencyParams & { tenantId?: string }) {
    return this.usageService.getUsage(params);
  }

  @Get('health')
  @Render('health')
  async healthPage(@Request() req: RequestUser) {
    return {
      user: req.user,
      isSuperAdmin: true,
      activePage: 'health',
    };
  }

  @ApiResponse({ status: 200 })
  @ApiOperation({ summary: 'Busca os detalhes do território' })
  @Get('territory-details')
  @Roles(Role.ADMIN)
  async territoryDetails(@Request() req: RequestUser) {
    return this.dashBoardService.territoryDetails(req.user.tenantId);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Busca todas as casas marcadas' })
  @Get('marked-houses')
  @Roles(Role.ADMIN)
  async findAll(@Request() req: RequestUser) {
    return this.dashBoardService.findMarkedHouses(req.user.tenantId);
  }
}
