import { RoundService } from './round.service';
import { Controller, Get, Logger, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { VERSION } from 'src/enum/version.enum';
import { RequestUser } from 'src/interfaces/RequestUser';

@ApiTags('Round')
@ApiBearerAuth()
@Controller({
  version: VERSION.V1,
  path: 'rounds',
})
export class RoundController {
  private logger = new Logger(RoundController.name);
  constructor(private roundService: RoundService) {}

  @Roles(Role.ADMIN)
  @Post('/start')
  async startAll(@Request() req: RequestUser): Promise<void> {
    await this.roundService.startRound(req.user.tenantId);
  }

  @Roles(Role.ADMIN)
  @Get('/info')
  async getAll(@Request() req: RequestUser): Promise<any> {
    return await this.roundService.getRoundInfo(req.user.tenantId);
  }

  @Roles(Role.ADMIN)
  @Get('/info/:roundNumber')
  async getOneByRoundNumber(@Request() req: RequestUser): Promise<any> {
    const roundNumber = req.params.roundNumber;
    return await this.roundService.getRoundInfoByRoundNumber(req.user.tenantId, +roundNumber);
  }

  @Roles(Role.ADMIN)
  @Get('/theme/:number')
  async getThemeRound(@Request() req: RequestUser) {
    const tenantId = req.user.tenantId;
    const roundNumber = req.params.number;
    return await this.roundService.getThemeRound(tenantId, +roundNumber);
  }

  @Roles(Role.ADMIN)
  @Get('/fix-round-info')
  async fixRound(@Request() req: RequestUser): Promise<any> {
    return await this.roundService.fixRoundInfo();
  }
}
