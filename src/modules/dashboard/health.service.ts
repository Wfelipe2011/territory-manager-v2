import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventsGateway } from '../gateway/event.gateway';
import * as os from 'os';
import si from 'systeminformation';
import { Prisma } from '@prisma/client';

@Injectable()
export class HealthService {
    private readonly logger = new Logger(HealthService.name);

    constructor(
        private readonly prismaService: PrismaService,
        private readonly eventsGateway: EventsGateway,
    ) { }

    async getHealthData() {
        const [databaseInfo, currentLoad, lastChanges, sessionsGeneral, sessionsByTenant] = await Promise.all([
            this.getDatabaseInfo(),
            si.currentLoad(),
            this.getLastChanges(),
            this.getGeneralSessions(),
            this.getTenantSessions(),
        ]);

        const {
            max_connections,
            countActive,
            countIdle,
            sockets,
            countSignatures
        } = databaseInfo;

        const { uptime, totalMem, usedMem, freeMem, memoryUsagePercent, loadAverage } = this.getSystemInfo();
        const cpuUsagePercent = currentLoad.currentLoad.toFixed(2);

        return {
            message: `[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] - [${process.env.INSTANCE_ID}] - O servidor está em execução - Produção!`,
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
            sessionsGeneral,
            sessionsByTenant,
        };
    }

    private getSystemInfo() {
        const uptime = os.uptime();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memoryUsagePercent = ((usedMem / totalMem) * 100).toFixed(2);
        const loadAverage = os.loadavg();
        return { uptime, totalMem, usedMem, freeMem, memoryUsagePercent, loadAverage };
    }

    private async getDatabaseInfo() {
        const [[{ max_connections }], [{ count: countActive }], [{ count: countIdle }], sockets, countSignatures] = await Promise.all([
            this.prismaService.$queryRaw`show max_connections` as Promise<{ max_connections: string }[]>,
            this.prismaService.$queryRaw`select count(1) from pg_stat_activity where state = 'active' and datname = ${process.env.POSTGRES_DB}` as Promise<{ count: BigInt }[]>,
            this.prismaService.$queryRaw`select count(1) from pg_stat_activity where state = 'idle' and datname = ${process.env.POSTGRES_DB}` as Promise<{ count: BigInt }[]>,
            Promise.resolve(this.eventsGateway.getConnectedSocketCount()),
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
        m.city as city,
        (COALESCE(r.update_date, r.completed_date, r.end_date, r.start_date)) AS last_change_utc_minus3
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
      ` as any[];
    }

    private async getGeneralSessions(): Promise<{ slot: string; started: number; active: number }[]> {
        const rows: { slot: Date; started: number; active: number }[] = await this.prismaService.$queryRaw`
            WITH slots AS (
                SELECT DISTINCT
                    date_trunc('hour', created_at)
                    + (FLOOR(EXTRACT(MINUTE FROM created_at) / 10) * INTERVAL '10 min') AS slot
                FROM socket
                WHERE created_at >= NOW() - INTERVAL '24 hours'
            )
            SELECT
                sl.slot,
                COUNT(CASE WHEN sk.created_at >= sl.slot AND sk.created_at < sl.slot + INTERVAL '10 min' THEN 1 END)::int AS started,
                COUNT(CASE WHEN sk.created_at < sl.slot + INTERVAL '10 min'
                               AND sk.disconnected_at IS NULL
                           THEN 1 END)::int AS active
            FROM slots sl
            JOIN socket sk ON sk.created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY sl.slot
            HAVING COUNT(CASE WHEN sk.created_at >= sl.slot AND sk.created_at < sl.slot + INTERVAL '10 min' THEN 1 END) > 0
            ORDER BY sl.slot DESC
        `;
        return rows.map(r => ({
            slot: r.slot.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
            started: r.started,
            active: r.active,
        }));
    }

    async getSessionsData(params: {
        period?: string;
        groupBy?: string;
        from?: string;
        to?: string;
    }): Promise<{ sessionsGeneral: { slot: string; started: number; active: number }[]; sessionsByTenant: { slot: string; tenant_name: string; started: number; active: number }[] }> {
        const validGroupBy = ['10min', '30min', '1h', '1d'];
        const validPeriod = ['1d', '3d', '7d'];
        const groupBy: string = (params.groupBy && validGroupBy.includes(params.groupBy)) ? params.groupBy : '10min';
        const period: string = (params.period && validPeriod.includes(params.period)) ? params.period : '1d';

        const SLOT_EXPRS: Record<string, { noAlias: string; withAlias: string; interval: string }> = {
            '10min': {
                noAlias: `date_trunc('hour', created_at) + (FLOOR(EXTRACT(MINUTE FROM created_at) / 10) * INTERVAL '10 min')`,
                withAlias: `date_trunc('hour', s.created_at) + (FLOOR(EXTRACT(MINUTE FROM s.created_at) / 10) * INTERVAL '10 min')`,
                interval: `INTERVAL '10 min'`,
            },
            '30min': {
                noAlias: `date_trunc('hour', created_at) + (FLOOR(EXTRACT(MINUTE FROM created_at) / 30) * INTERVAL '30 min')`,
                withAlias: `date_trunc('hour', s.created_at) + (FLOOR(EXTRACT(MINUTE FROM s.created_at) / 30) * INTERVAL '30 min')`,
                interval: `INTERVAL '30 min'`,
            },
            '1h': {
                noAlias: `date_trunc('hour', created_at)`,
                withAlias: `date_trunc('hour', s.created_at)`,
                interval: `INTERVAL '1 hour'`,
            },
            '1d': {
                noAlias: `date_trunc('day', created_at)`,
                withAlias: `date_trunc('day', s.created_at)`,
                interval: `INTERVAL '1 day'`,
            },
        };

        const PERIOD_DAYS: Record<string, number> = { '1d': 1, '3d': 3, '7d': 7 };
        const expr = SLOT_EXPRS[groupBy];
        const slotNoAlias = Prisma.raw(expr.noAlias);
        const slotWithAlias = Prisma.raw(expr.withAlias);
        const intervalRaw = Prisma.raw(expr.interval);

        let whereCTE: Prisma.Sql;
        let whereCTE_s: Prisma.Sql;
        let whereJoin: Prisma.Sql;

        if (params.from && params.to) {
            const fromDate = new Date(params.from);
            const toDate = new Date(params.to);
            whereCTE = Prisma.sql`created_at BETWEEN ${fromDate} AND ${toDate}`;
            whereCTE_s = Prisma.sql`s.created_at BETWEEN ${fromDate} AND ${toDate}`;
            whereJoin = Prisma.sql`sk.created_at BETWEEN ${fromDate} AND ${toDate}`;
        } else {
            const days = PERIOD_DAYS[period];
            const intervalDays = Prisma.raw(`INTERVAL '${days} days'`);
            whereCTE = Prisma.sql`created_at >= NOW() - ${intervalDays}`;
            whereCTE_s = Prisma.sql`s.created_at >= NOW() - ${intervalDays}`;
            whereJoin = Prisma.sql`sk.created_at >= NOW() - ${intervalDays}`;
        }

        const [generalRows, tenantRows] = await Promise.all([
            this.prismaService.$queryRaw<{ slot: Date; started: number; active: number }[]>(Prisma.sql`
                WITH slots AS (
                    SELECT DISTINCT ${slotNoAlias} AS slot
                    FROM socket
                    WHERE ${whereCTE}
                )
                SELECT
                    sl.slot,
                    COUNT(CASE WHEN sk.created_at >= sl.slot AND sk.created_at < sl.slot + ${intervalRaw} THEN 1 END)::int AS started,
                    COUNT(CASE WHEN sk.created_at < sl.slot + ${intervalRaw} AND sk.disconnected_at IS NULL THEN 1 END)::int AS active
                FROM slots sl
                JOIN socket sk ON ${whereJoin}
                GROUP BY sl.slot
                HAVING COUNT(CASE WHEN sk.created_at >= sl.slot AND sk.created_at < sl.slot + ${intervalRaw} THEN 1 END) > 0
                ORDER BY sl.slot DESC
            `),
            this.prismaService.$queryRaw<{ slot: Date; tenant_name: string; started: number; active: number }[]>(Prisma.sql`
                WITH slots AS (
                    SELECT DISTINCT
                        ${slotWithAlias} AS slot,
                        s.tenant_id
                    FROM socket s
                    WHERE ${whereCTE_s}
                )
                SELECT
                    sl.slot,
                    m.name AS tenant_name,
                    COUNT(CASE WHEN sk.created_at >= sl.slot AND sk.created_at < sl.slot + ${intervalRaw} THEN 1 END)::int AS started,
                    COUNT(CASE WHEN sk.created_at < sl.slot + ${intervalRaw} AND sk.disconnected_at IS NULL THEN 1 END)::int AS active
                FROM slots sl
                JOIN socket sk ON sk.tenant_id = sl.tenant_id AND ${whereJoin}
                JOIN multi_tenancy m ON m.id = sl.tenant_id
                GROUP BY sl.slot, m.name
                HAVING COUNT(CASE WHEN sk.created_at >= sl.slot AND sk.created_at < sl.slot + ${intervalRaw} THEN 1 END) > 0
                ORDER BY sl.slot DESC, m.name
            `),
        ]);

        const slotFormat: Intl.DateTimeFormatOptions = groupBy === '1d'
            ? { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }
            : { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };

        return {
            sessionsGeneral: generalRows.map(r => ({
                slot: r.slot.toLocaleString('pt-BR', slotFormat),
                started: r.started,
                active: r.active,
            })),
            sessionsByTenant: tenantRows.map(r => ({
                slot: r.slot.toLocaleString('pt-BR', slotFormat),
                tenant_name: r.tenant_name,
                started: r.started,
                active: r.active,
            })),
        };
    }

    private async getTenantSessions(): Promise<{ slot: string; tenant_name: string; started: number; active: number }[]> {
        const rows: { slot: Date; tenant_name: string; started: number; active: number }[] = await this.prismaService.$queryRaw`
            WITH slots AS (
                SELECT DISTINCT
                    date_trunc('hour', s.created_at)
                    + (FLOOR(EXTRACT(MINUTE FROM s.created_at) / 10) * INTERVAL '10 min') AS slot,
                    s.tenant_id
                FROM socket s
                WHERE s.created_at >= NOW() - INTERVAL '24 hours'
            )
            SELECT
                sl.slot,
                m.name AS tenant_name,
                COUNT(CASE WHEN sk.created_at >= sl.slot AND sk.created_at < sl.slot + INTERVAL '10 min' THEN 1 END)::int AS started,
                COUNT(CASE WHEN sk.created_at < sl.slot + INTERVAL '10 min'
                               AND sk.disconnected_at IS NULL
                           THEN 1 END)::int AS active
            FROM slots sl
            JOIN socket sk ON sk.tenant_id = sl.tenant_id AND sk.created_at >= NOW() - INTERVAL '24 hours'
            JOIN multi_tenancy m ON m.id = sl.tenant_id
            GROUP BY sl.slot, m.name
            HAVING COUNT(CASE WHEN sk.created_at >= sl.slot AND sk.created_at < sl.slot + INTERVAL '10 min' THEN 1 END) > 0
            ORDER BY sl.slot DESC, m.name
        `;
        return rows.map(r => ({
            slot: r.slot.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
            tenant_name: r.tenant_name,
            started: r.started,
            active: r.active,
        }));
    }
}
