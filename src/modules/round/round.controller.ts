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
  @Get('/')
  async getAll(@Request() req: RequestUser): Promise<any> {
    console.log(req.user);
    return await this.roundService.getAll(req.user.tenantId);
  }
}
