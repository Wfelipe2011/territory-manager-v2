import { Body, Controller, Delete, Get, Logger, Param, ParseIntPipe, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { VERSION } from 'src/enum/version.enum';
import { Role } from 'src/enum/role.enum';
import { Roles } from 'src/decorators/roles.decorator';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { UserToken } from '../auth/contracts';
import { UpsertBlockDto } from './contracts/UpsertBlockDto';
import { BlockService } from './block.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiBearerAuth()
@ApiTags('Block')
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

  @Delete('territories/:territoryId/blocks/:blockId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Deleta um quadra e suas dependências' })
  async deleteBlock(@Param('blockId', ParseIntPipe) blockId: number, @Param('territoryId', ParseIntPipe) territoryId: number, @CurrentUser() user: UserToken) {
    this.logger.log('Iniciando deleteBlock');
    return this.blockService.deleteBlock(blockId, territoryId, user.tenantId);
  }

  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Cria ou atualiza um quadra' })
  @Post('territories/:territoryId/blocks')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async upsertBlock(@Param('territoryId', ParseIntPipe) territoryId: number, @Body() upsertBlockDto: UpsertBlockDto, @CurrentUser() user: UserToken) {
    this.logger.log('Iniciando upsertBlock');
    return this.blockService.upsertBlock(upsertBlockDto, user.tenantId, territoryId);
  }

}
