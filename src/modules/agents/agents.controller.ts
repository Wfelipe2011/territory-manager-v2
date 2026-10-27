import { Controller, Delete, Get, Param, Request } from '@nestjs/common';
import { Roles } from '../../decorators/roles.decorator';
import { SkipCache } from '../../decorators/skip-cache.decorator';
import { Role } from '../../enum/role.enum';
import { RequestUser } from '../../interfaces/RequestUser';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { agentConfig, agentTenantEnabled } from './agent.config';

@Controller({ version: '1', path: 'agent-integrations' })
@Roles(Role.ADMIN)
@SkipCache()
export class AgentIntegrationsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  async list(@Request() req: RequestUser) {
    const connections = await this.prisma.agent_connection.findMany({
      where: { tenantId: req.user.tenantId, userId: req.user.userId },
      select: { id: true, clientName: true, scopes: true, createdAt: true, expiresAt: true, revokedAt: true },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    const config = agentConfig();
    const enabled = agentTenantEnabled(req.user.tenantId);
    return { enabled, mcpUrl: enabled ? config.resource : null, connections };
  }
  @Delete(':id')
  async revoke(@Request() req: RequestUser, @Param('id') id: string) {
    await this.prisma.agent_connection.updateMany({ where: { id, tenantId: req.user.tenantId, userId: req.user.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { revoked: true };
  }
}
