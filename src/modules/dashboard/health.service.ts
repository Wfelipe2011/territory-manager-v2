import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ConcurrencyParams, ConcurrencyService } from './concurrency.service';
import * as os from 'os';
import si from 'systeminformation';

@Injectable()
export class HealthService {
  constructor(private readonly prismaService: PrismaService, private readonly concurrency: ConcurrencyService) {}

  async getHealthData() {
    const [database, load, lastChanges, sessions] = await Promise.all([
      this.getDatabaseInfo(), si.currentLoad(), this.getLastChanges(), this.concurrency.history(),
    ]);
    const total = os.totalmem();
    const free = os.freemem();
    const average = os.loadavg();
    return {
      message: `[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] - [${process.env.INSTANCE_ID}] - O servidor está em execução`,
      signatures: database.countSignatures,
      sockets: sessions.online, // Compatibility only; this is NOT a socket count.
      activeSessions: sessions.online,
      database_info: {
        active: Number(database.countActive), idle: Number(database.countIdle), max_connections: Number(database.max_connections),
      },
      system_info: {
        uptime_seconds: os.uptime(), total_memory_mb: (total / 1024 / 1024).toFixed(2),
        used_memory_mb: ((total - free) / 1024 / 1024).toFixed(2), free_memory_mb: (free / 1024 / 1024).toFixed(2),
        memory_usage_percent: ((total - free) / total * 100).toFixed(2), cpu_usage_percent: load.currentLoad.toFixed(2),
        load_average: { '1_min': average[0], '5_min': average[1], '15_min': average[2] },
      },
      last_changes: lastChanges,
      ...sessions,
    };
  }

  getSessionsData(params: ConcurrencyParams) { return this.concurrency.history(params); }

  private async getDatabaseInfo() {
    const [[{ max_connections }], [{ count: countActive }], [{ count: countIdle }], countSignatures] = await Promise.all([
      this.prismaService.$queryRaw`show max_connections` as Promise<{ max_connections: string }[]>,
      this.prismaService.$queryRaw`select count(1) from pg_stat_activity where state = 'active' and datname = ${process.env.POSTGRES_DB}` as Promise<{ count: bigint }[]>,
      this.prismaService.$queryRaw`select count(1) from pg_stat_activity where state = 'idle' and datname = ${process.env.POSTGRES_DB}` as Promise<{ count: bigint }[]>,
      this.prismaService.signature.count({ where: { expirationDate: { gt: new Date() } } }),
    ]);
    return { max_connections, countActive, countIdle, countSignatures };
  }

  private getLastChanges() {
    return this.prismaService.$queryRaw<any[]>`
      SELECT m.name AS congregation, r.round_number AS round, m.city AS city,
        COALESCE(r.update_date, r.completed_date, r.end_date, r.start_date) AS last_change_utc_minus3
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY COALESCE(update_date, completed_date, end_date, start_date) DESC) AS row_num
        FROM round
      ) r JOIN multi_tenancy m ON r.tenant_id=m.id
      WHERE r.row_num=1 ORDER BY last_change_utc_minus3 DESC`;
  }
}
