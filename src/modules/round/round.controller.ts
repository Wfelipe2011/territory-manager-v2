import { RoundService } from './round.service';
import { Body, Controller, Get, Logger, Param, ParseIntPipe, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { VERSION } from 'src/enum/version.enum';
import { UserToken } from '../auth/contracts';
import { CreateRoundDto } from './contracts/CreateRoundDto';

@ApiTags('Round')
@ApiBearerAuth()
@Controller({
  version: VERSION.V1,
  path: 'rounds',
})
export class RoundController {
  private logger = new Logger(RoundController.name);
  constructor(private roundService: RoundService) { }

  @Roles(Role.ADMIN)
  @Post('/start')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async startAll(@CurrentUser() user: UserToken, @Body() body: CreateRoundDto): Promise<void> {
    await this.roundService.startRound(user.tenantId, body);
  }

  @Roles(Role.ADMIN)
  @Post('/finish')
  async finishAll(@CurrentUser() user: UserToken, @Body() body: { roundNumber: number }): Promise<void> {
    if (!body.roundNumber) {
      this.logger.error('Round number is required');
      throw new Error('Round number is required');
    }
    await this.roundService.finishRound(user.tenantId, +body.roundNumber);
  }

  @Roles(Role.ADMIN)
  @Get('/info')
  async getAll(@CurrentUser() user: UserToken): Promise<any> {
    return await this.roundService.getRoundInfo(user.tenantId);
  }

  @Roles(Role.ADMIN)
  @Get('/info/:roundNumber')
  async getOneByRoundNumber(@CurrentUser() user: UserToken, @Param('roundNumber', ParseIntPipe) roundNumber: number): Promise<any> {
    return await this.roundService.getRoundInfoByRoundNumber(user.tenantId, roundNumber);
  }

  @Roles(Role.ADMIN)
  @Get('/theme/:number')
  async getThemeRound(@CurrentUser() user: UserToken, @Param('number', ParseIntPipe) roundNumber: number): Promise<any> {
    const tenantId = user.tenantId;
    return await this.roundService.getThemeRound(tenantId, roundNumber);
  }

  @Roles(Role.ADMIN)
  @Get('/fix-round-info')
  async fixRound(@CurrentUser() user: UserToken): Promise<any> {
    return await this.roundService.fixRoundInfo();
  }
}
