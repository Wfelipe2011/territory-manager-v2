import { PrismaService } from './infra/prisma.service';
import { Controller, Get, Logger } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './decorators/public.decorator';
import { VERSION } from './enum/version.enum';

@ApiTags('Verificação de Saúde')
@Controller({
  version: VERSION.V1,
})
export class AppController {
  logger = new Logger(AppController.name);
  constructor(private prismaService: PrismaService) {}

  @Public()
  @ApiOperation({ summary: 'Verificação de saúde do servidor' })
  @ApiOkResponse({ description: 'Servidor está em execução', type: String })
  @Get('/health-check')
  async healthCheck() {
    const countSignatures = await this.prismaService.signature.count({
      where: {
        expirationDate: {
          lte: new Date(),
        },
      },
    });
    const [{ max_connections }] = (await this.prismaService.$queryRaw`show max_connections`) as { max_connections: string }[];
    const [{ count: countActive }] = (await this.prismaService
      .$queryRaw`select count(1)  from pg_stat_activity where state = 'active' and datname = ${process.env.POSTGRES_DB}`) as {
      count: BigInt;
    }[];
    const [{ count: countIdle }] = (await this.prismaService
      .$queryRaw`select count(1)  from pg_stat_activity where state = 'idle' and datname = ${process.env.POSTGRES_DB}`) as {
      count: BigInt;
    }[];

    return {
      message: `[${new Date().toISOString()}] - [${process.env.INSTANCE_ID}] - O servidor está em execução - Homologação!`,
      signatures: countSignatures,
      database_info: {
        active: +countActive.toString(),
        idle: +countIdle.toString(),
        max_connections: +max_connections,
      },
    };
  }
}
