import { Controller, Delete, Get, Logger, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { VERSION } from 'src/enum/version.enum';
import { RequestUser } from 'src/interfaces/RequestUser';

import { SignatureService } from './signature.service';

@ApiBearerAuth()
@ApiTags('Signature')
@Controller({
  version: VERSION.V1,
  path: 'tenants/signature',
})
export class TenantSignatureController {
  private readonly logger = new Logger(TenantSignatureController.name);

  constructor(private readonly signatureService: SignatureService) {}

  @Post()
  @Roles(Role.ADMIN)
  async createTenantSignature(@Request() req: RequestUser) {
    try {
      return await this.signatureService.generateTenantSignature(req.user.tenantId);
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Get()
  @Roles(Role.ADMIN)
  async getTenantSignature(@Request() req: RequestUser) {
    try {
      return await this.signatureService.getTenantSignature(req.user.tenantId);
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Delete()
  @Roles(Role.ADMIN)
  async revokeTenantSignature(@Request() req: RequestUser) {
    try {
      return await this.signatureService.revokeTenantSignature(req.user.tenantId);
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }
}
