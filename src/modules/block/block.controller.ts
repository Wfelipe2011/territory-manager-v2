import { Body, Controller, Get, Logger, Param, ParseIntPipe, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { VERSION } from 'src/enum/version.enum';
import { Role } from 'src/enum/role.enum';
import { Roles } from 'src/decorators/roles.decorator';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { UserToken } from '../auth/contracts';
import { UpsertBlockDto } from './contracts/UpsertBlockDto';
import { BlockService } from './block.service';

@Controller({ version: VERSION.V2, path: '' })
export class BlockController {
  private readonly logger = new Logger(BlockController.name);

  constructor(private readonly blockService: BlockService) { }

  @Get('territories/:territoryId/blocks')
  @Roles(Role.ADMIN)
  async getTerritoryBlocks(@Param('territoryId', ParseIntPipe) territoryId: number, @CurrentUser() user: UserToken) {
    this.logger.log('Iniciando getTerritoryBlockDetails');
    return this.blockService.getTerritoryBlocks(territoryId, user.tenantId);
  }

  @Get('territories/:territoryId/blocks/:blockId')
  @Roles(Role.ADMIN)
  async getTerritoryBlockDetails(@Param('blockId', ParseIntPipe) blockId: number, @Param('territoryId', ParseIntPipe) territoryId: number, @CurrentUser() user: UserToken) {
    this.logger.log('Iniciando getTerritoryBlockDetails');
    return this.blockService.getTerritoryBlockDetails(blockId, territoryId, user.tenantId);
  }

  @Post('territories/:territoryId/blocks')
  @Roles(Role.ADMIN)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async upsertBlock(@Param('territoryId', ParseIntPipe) territoryId: number, @Body() upsertBlockDto: UpsertBlockDto, @CurrentUser() user: UserToken) {
    this.logger.log('Iniciando upsertBlock');
    return this.blockService.upsertBlock(upsertBlockDto, user.tenantId, territoryId);
  }

}
