import { Controller, Get, Logger, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { VERSION } from 'src/enum/version.enum';
import { PrismaService } from 'src/infra/prisma.service';
import { RequestUser } from 'src/interfaces/RequestUser';

@ApiBearerAuth()
@Controller({
  version: VERSION.V1,
  path: 'tenancy',
})
export class TenancyController {
  private logger = new Logger(TenancyController.name);
  constructor(readonly prisma: PrismaService) {}

  @Roles(Role.ADMIN, Role.DIRIGENTE, Role.PUBLICADOR)
  @Get('/info')
  async info(@Request() req: RequestUser) {
    this.logger.log(`User ${req.user.id} requested tenancy info`);
    const tenant = await this.prisma.multitenancy.findUnique({
      where: {
        id: req.user.tenantId,
      },
    });
    return tenant;
  }
}
