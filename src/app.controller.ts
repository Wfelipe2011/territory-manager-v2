import { PrismaService } from './infra/prisma/prisma.service';
import { Controller, Get, Logger } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './decorators/public.decorator';
import { VERSION } from './enum/version.enum';
import * as os from 'os';
import si from 'systeminformation'; // Adicione via `npm install systeminformation`

@ApiTags('Verificação de Saúde')
@Controller({
  version: VERSION.V1,
})
export class AppController {
  logger = new Logger(AppController.name);
  constructor(private prismaService: PrismaService) { }

  @Public()
  @ApiOperation({ summary: 'Verificação de saúde do servidor' })
  @ApiOkResponse({ description: 'Servidor está em execução', type: String })
  @Get('/health-check')
  async healthCheck() {
    // Contagem de assinaturas expiradas
    const countSignatures = await this.prismaService.signature.count({
      where: {
        expirationDate: {
          gt: new Date(),
        },
      },
    });

    // Consultas ao banco de dados
    const [{ max_connections }] = (await this.prismaService.$queryRaw`show max_connections`) as { max_connections: string }[];
    const [{ count: countActive }] = (await this.prismaService
      .$queryRaw`select count(1) from pg_stat_activity where state = 'active' and datname = ${process.env.POSTGRES_DB}`) as {
        count: BigInt;
      }[];
    const [{ count: countIdle }] = (await this.prismaService
      .$queryRaw`select count(1) from pg_stat_activity where state = 'idle' and datname = ${process.env.POSTGRES_DB}`) as {
        count: BigInt;
      }[];
    const sockets = await this.prismaService.socket.count();

    // Informações do sistema operacional
    const uptime = os.uptime(); // Tempo de atividade do sistema em segundos
    const totalMem = os.totalmem(); // Memória total (bytes)
    const freeMem = os.freemem(); // Memória livre (bytes)
    const usedMem = totalMem - freeMem; // Memória usada (bytes)
    const memoryUsagePercent = ((usedMem / totalMem) * 100).toFixed(2); // Porcentagem usada
    const loadAverage = os.loadavg(); // Carga média do sistema nos últimos 1, 5, 15 minutos

    // Informações detalhadas de CPU
    const currentLoad = await si.currentLoad();
    const cpuUsagePercent = currentLoad.currentLoad.toFixed(2); // Percentual de uso da CPU

    return {
      message: `[${new Date().toISOString()}] - [${process.env.INSTANCE_ID}] - O servidor está em execução - Produção!`,
      signatures: countSignatures,
      sockets,
      database_info: {
        active: +countActive.toString(),
        idle: +countIdle.toString(),
        max_connections: +max_connections,
      },
      system_info: {
        uptime_seconds: uptime,
        total_memory_mb: (totalMem / 1024 / 1024).toFixed(2),
        used_memory_mb: (usedMem / 1024 / 1024).toFixed(2),
        free_memory_mb: (freeMem / 1024 / 1024).toFixed(2),
        memory_usage_percent: memoryUsagePercent,
        cpu_usage_percent: cpuUsagePercent,
        load_average: {
          "1_min": loadAverage[0],
          "5_min": loadAverage[1],
          "15_min": loadAverage[2],
        },
      },
    };
  }
}
