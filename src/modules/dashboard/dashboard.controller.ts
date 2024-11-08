import { Controller, Get, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiResponse, ApiOperation } from '@nestjs/swagger';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { VERSION } from 'src/enum/version.enum';
import { DashboardService } from './dashboard.service';
import { RequestUser } from 'src/interfaces/RequestUser';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller({
  version: VERSION.V1,
  path: 'dashboard',
})
export class DashboardController {
  constructor(readonly dashBoardService: DashboardService) {}

  @ApiResponse({ status: 200 })
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
