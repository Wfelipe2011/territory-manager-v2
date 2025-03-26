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

    const [databaseInfo, currentLoad, lastChanges] = await Promise.all([
      this.getDatabaseInfo(),
      si.currentLoad(),
      this.getLastChanges(),
    ]);

    const {
      max_connections,
      countActive,
      countIdle,
      sockets,
      countSignatures
    } = databaseInfo
    const { uptime, totalMem, usedMem, freeMem, memoryUsagePercent, loadAverage } = this.getSystemInfo(); // Carga média do sistema nos últimos 1, 5, 15 minutos
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
      last_changes: lastChanges,
    };
  }

  private getSystemInfo() {
    const uptime = os.uptime(); // Tempo de atividade do sistema em segundos
    const totalMem = os.totalmem(); // Memória total (bytes)
    const freeMem = os.freemem(); // Memória livre (bytes)
    const usedMem = totalMem - freeMem; // Memória usada (bytes)
    const memoryUsagePercent = ((usedMem / totalMem) * 100).toFixed(2); // Porcentagem usada
    const loadAverage = os.loadavg(); // Carga média do sistema nos últimos 1, 5, 15 minutos
    return { uptime, totalMem, usedMem, freeMem, memoryUsagePercent, loadAverage };
  }

  private async getDatabaseInfo() {
    const [[{ max_connections }], [{ count: countActive }], [{ count: countIdle }], sockets, countSignatures] = await Promise.all([
      this.prismaService.$queryRaw`show max_connections` as Promise<{ max_connections: string }[]>,
      this.prismaService.$queryRaw`select count(1) from pg_stat_activity where state = 'active' and datname = ${process.env.POSTGRES_DB}` as Promise<{ count: BigInt }[]>,
      this.prismaService.$queryRaw`select count(1) from pg_stat_activity where state = 'idle' and datname = ${process.env.POSTGRES_DB}` as Promise<{ count: BigInt }[]>,
      this.prismaService.socket.count(),
      this.prismaService.signature.count({
        where: {
          expirationDate: {
            gt: new Date(),
          },
        },
      })
    ]);
    return {
      max_connections,
      countActive,
      countIdle,
      sockets,
      countSignatures
    };
  }

  private async getLastChanges() {
    return await this.prismaService.$queryRaw`
      SELECT
        m.name AS congregation,
        r.round_number as round,
        (COALESCE(r.update_date, r.completed_date, r.end_date, r.start_date) - INTERVAL '3 hours') AS last_change_utc_minus3
      FROM (
        SELECT 
          *,
          ROW_NUMBER() OVER (
            PARTITION BY tenant_id 
            ORDER BY 
              COALESCE(update_date, completed_date, end_date, start_date) DESC
          ) AS row_num
        FROM 
          round
      ) AS r
      JOIN multi_tenancy m ON r.tenant_id = m.id
      WHERE 
        r.row_num = 1
      ORDER BY 
        last_change_utc_minus3 DESC;
      `;
  }
}
