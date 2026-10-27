import { Controller, Get, Logger, Param, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { VERSION } from 'src/enum/version.enum';
import { AddressService } from './address.service';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { UserToken } from '../auth/contracts';

const logger = new Logger('AddressController');
@ApiBearerAuth()
@ApiTags('Address')
@Controller({
  version: VERSION.V1,
})
export class AddressController {
  constructor(private addressService: AddressService) { }
  @Roles(Role.ADMIN)
  @Get('territories/:territoryId/addresses')
  async findAll(@Param('territoryId') territoryId: number, @CurrentUser() user: UserToken) {
    try {
      const result = await this.addressService.findAll(+territoryId, user.tenantId);
      return result;
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  @ApiOperation({ summary: 'Retorna todos os endereços' })
  @Roles(Role.ADMIN)
  @Get('addresses')
  async findAllAddresses(@CurrentUser() user: UserToken) {
    try {
      return await this.addressService.findAllAddresses(user.tenantId);
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }
}
