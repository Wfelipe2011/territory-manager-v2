import { Controller, Get, Param, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { VERSION } from 'src/enum/version.enum';
import { logger } from 'src/infra/logger';
import { AddressService } from './address.service';
import { RequestSignature } from 'src/interfaces/RequestUser';

@ApiBearerAuth()
@ApiTags('Address')
@Controller({
  version: VERSION.V1,
})
export class AddressController {
  constructor(private addressService: AddressService) {}
  @Roles(Role.ADMIN)
  @Get('territories/:territoryId/addresses')
  async findAll(@Param('territoryId') territoryId: number) {
    try {
      const result = await this.addressService.findAll(+territoryId);
      return result;
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }
}
