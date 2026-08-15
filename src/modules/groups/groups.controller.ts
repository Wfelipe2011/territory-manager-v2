import { Body, Controller, Delete, Get, Logger, Param, Patch, Post, Request, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { VERSION } from 'src/enum/version.enum';
import { RequestUser } from 'src/interfaces/RequestUser';

import { CreateGroupDto } from './contracts/CreateGroupDto';
import { UpdateGroupDto } from './contracts/UpdateGroupDto';
import { GroupsService } from './groups.service';

@ApiBearerAuth()
@ApiTags('Groups')
@Controller({
  version: VERSION.V1,
  path: 'groups',
})
export class GroupsController {
  private readonly logger = new Logger(GroupsController.name);

  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Lista os grupos do tenant' })
  async findAll(@Request() req: RequestUser) {
    try {
      return await this.groupsService.findAll(req.user.tenantId);
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Post()
  @Roles(Role.ADMIN)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Cria um grupo no tenant' })
  async create(@Body() body: CreateGroupDto, @Request() req: RequestUser) {
    try {
      return await this.groupsService.create(body.name, req.user.tenantId);
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Renomeia um grupo do tenant' })
  async update(@Param('id') id: string, @Body() body: UpdateGroupDto, @Request() req: RequestUser) {
    try {
      return await this.groupsService.update(id, body.name, req.user.tenantId);
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Remove um grupo do tenant (presenças e atribuições inclusas)' })
  async remove(@Param('id') id: string, @Request() req: RequestUser) {
    try {
      return await this.groupsService.remove(id, req.user.tenantId);
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }
}
