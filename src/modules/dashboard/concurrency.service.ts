import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface ConcurrencyParams { period?: string; groupBy?: string; from?: string; to?: string }

@Injectable()
export class ConcurrencyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConcurrencyService.name);
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Independent of dashboard visits and mobile requests. Shared DB lock + bucket
    // uniqueness prevent duplicate collection/rollups across API replicas.
    this.tick();
    this.timer = setInterval(() => this.tick(), 30_000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.pending;
  }

  private tick() {
    if (this.pending) return;
    this.pending = this.collect().catch(() => {
      this.logger.error('Falha ao coletar simultaneidade de campo; verificar banco e migrations.');
    }).finally(() => { this.pending = undefined; });
  }

  async collect(): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(260026, 30) AS acquired`;
      if (!lock.acquired) return;
      await tx.$executeRaw`
        WITH presence AS MATERIALIZED (
          SELECT DISTINCT fs.tenant_id, fs.client_id
          FROM field_session fs
          JOIN signature s ON s.key=fs.signature_key AND s.tenant_id=fs.tenant_id
          WHERE fs.disconnected_at IS NULL
            AND fs.last_seen_at > now() - interval '60 seconds'
            AND s.expiration_date > now()
        ), counts AS (
          SELECT 0 AS scope_id, count(DISTINCT client_id)::int AS active FROM presence
          UNION ALL
          SELECT m.id, count(p.client_id)::int FROM multi_tenancy m
          LEFT JOIN presence p ON p.tenant_id=m.id GROUP BY m.id
        ), inserted AS (
          INSERT INTO field_concurrency_sample(sampled_at, scope_id, active)
          SELECT date_bin(interval '30 seconds', now(), timestamptz '2000-01-01'), scope_id, active FROM counts
          ON CONFLICT DO NOTHING RETURNING *
        )
        INSERT INTO field_concurrency_hour(bucket_at, scope_id, samples, active_sum, peak, peak_at)
        SELECT date_bin(interval '1 hour', sampled_at, timestamptz '2000-01-01'), scope_id, 1, active, active, sampled_at FROM inserted
        ON CONFLICT (bucket_at, scope_id) DO UPDATE SET
          samples=field_concurrency_hour.samples+1,
          active_sum=field_concurrency_hour.active_sum+EXCLUDED.active_sum,
          peak=GREATEST(field_concurrency_hour.peak, EXCLUDED.peak),
          peak_at=CASE WHEN EXCLUDED.peak > field_concurrency_hour.peak THEN EXCLUDED.peak_at ELSE field_concurrency_hour.peak_at END`;
      // Hourly aggregates are already durable before detailed samples expire.
      await tx.$executeRaw`DELETE FROM field_concurrency_sample WHERE sampled_at < date_trunc('hour', now() - interval '90 days')`;
    });
  }

  async current() {
    const rows = await this.prisma.$queryRaw<{ scope_id: number; active: number }[]>`
      WITH presence AS (
        SELECT DISTINCT fs.tenant_id, fs.client_id FROM field_session fs
        JOIN signature s ON s.key=fs.signature_key AND s.tenant_id=fs.tenant_id
        WHERE fs.disconnected_at IS NULL AND fs.last_seen_at > now()-interval '60 seconds' AND s.expiration_date > now()
      )
      SELECT 0 AS scope_id, count(DISTINCT client_id)::int AS active FROM presence
      UNION ALL
      SELECT m.id, count(p.client_id)::int FROM multi_tenancy m LEFT JOIN presence p ON p.tenant_id=m.id GROUP BY m.id`;
    return rows;
  }

  async history(params: ConcurrencyParams = {}) {
    const now = new Date();
    const days: Record<string, number> = { '1d': 1, '3d': 3, '7d': 7, '30d': 30 };
    if (Boolean(params.from) !== Boolean(params.to)) throw new BadRequestException('Informe início e fim.');
    let from = params.from ? new Date(params.from) : new Date(now.getTime() - (days[params.period || '1d'] || 1) * 86400000);
    let to = params.to ? new Date(params.to) : now;
    if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to || +to - +from > 366 * 86400000) {
      throw new BadRequestException('Período inválido; selecione até 366 dias.');
    }
    const groups: Record<string, number> = { '10min': 600, '30min': 1800, '1h': 3600, '1d': 86400 };
    let seconds = groups[params.groupBy || '10min'] || 600;
    // Bound payload/chart size and avoid repeatedly scanning millions of raw
    // samples for month/year views. Hourly rollups preserve weighted means/peaks.
    if (+to - +from > 7 * 86400000) seconds = Math.max(3600, seconds);
    if (+to - +from > 31 * 86400000) seconds = 86400;
    // Older data has hourly resolution; never pretend it is still 30s detail.
    const cutoff = new Date(Math.floor((+now - 90 * 86400000) / 3600000) * 3600000);
    const hourly = from < cutoff || seconds >= 3600;
    if (hourly) {
      seconds = Math.max(3600, seconds);
      from = new Date(Math.floor(+from / 3600000) * 3600000);
      to = new Date(Math.ceil(+to / 3600000) * 3600000);
    }
    const interval = `${seconds} seconds`;
    const source = hourly
      ? Prisma.sql`SELECT bucket_at AS at, scope_id, samples, active_sum, peak, peak_at FROM field_concurrency_hour WHERE bucket_at >= ${from} AND bucket_at < ${to}`
      : Prisma.sql`SELECT sampled_at AS at, scope_id, 1 AS samples, active::bigint AS active_sum, active AS peak, sampled_at AS peak_at FROM field_concurrency_sample WHERE sampled_at >= ${from} AND sampled_at < ${to}`;
    const rows = await this.prisma.$queryRaw<{
      slot_at: Date; scope_id: number; tenant_name: string | null;
      average: number; active: number; peak_at: Date; samples: number;
    }[]>(Prisma.sql`
      WITH source AS (${source}), ranked AS (
        SELECT *, date_bin(${interval}::interval, at, timestamptz '2000-01-01') AS slot_at,
          row_number() OVER (PARTITION BY scope_id, date_bin(${interval}::interval, at, timestamptz '2000-01-01') ORDER BY peak DESC, peak_at) AS rank
        FROM source
      )
      SELECT r.slot_at, r.scope_id, m.name AS tenant_name,
        round(sum(active_sum)::numeric / sum(samples), 2)::float8 AS average,
        max(peak)::int AS active, max(peak_at) FILTER (WHERE rank=1) AS peak_at,
        sum(samples)::int AS samples
      FROM ranked r LEFT JOIN multi_tenancy m ON m.id=r.scope_id
      GROUP BY r.slot_at, r.scope_id, m.name ORDER BY r.slot_at DESC, r.scope_id`);
    const [current, [latest]] = await Promise.all([
      this.current(),
      this.prisma.$queryRaw<{ at: Date | null }[]>`SELECT max(sampled_at) AS at FROM field_concurrency_sample WHERE scope_id=0`,
    ]);
    const format = (r: typeof rows[number]) => ({
      slot: r.slot_at.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      slotAt: r.slot_at.toISOString(), tenantId: r.scope_id,
      tenant_name: r.tenant_name || `Congregação ${r.scope_id}`,
      average: r.average, active: r.active, peakAt: r.peak_at.toISOString(), samples: r.samples,
    });
    const general = rows.filter(r => r.scope_id === 0);
    const peak = general.reduce<typeof rows[number] | undefined>((best, r) => !best || r.active > best.active || (r.active === best.active && r.peak_at < best.peak_at) ? r : best, undefined);
    return {
      sessionsGeneral: general.map(format),
      sessionsByTenant: rows.filter(r => r.scope_id !== 0).map(format),
      online: current.find(r => r.scope_id === 0)?.active || 0,
      onlineByTenant: current.filter(r => r.scope_id !== 0),
      peak: peak ? { active: peak.active, at: peak.peak_at.toISOString() } : null,
      resolutionSeconds: hourly ? 3600 : 30, groupSeconds: seconds,
      lastCollectedAt: latest.at?.toISOString() || null,
      from: from.toISOString(), to: to.toISOString(),
    };
  }
}
