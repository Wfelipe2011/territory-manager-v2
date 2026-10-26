import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ApiMetrics } from './metrics.middleware';
import { MetricBucket, MetricsSnapshot, summarizeMetrics } from './request-metrics';
import * as os from 'os';
import si from 'systeminformation';

type State = 'operational' | 'degraded' | 'unavailable' | 'unknown';
type Observation = { state: State; observedAt: string | null; detail: string; latencyMs?: number; [key: string]: unknown };
type WorkerObservation = { metrics: MetricsSnapshot; health: { readModelEnabled: boolean; listenerConnected: boolean; poolSize: number; poolTotal: number; poolIdle: number; poolWaiting: number; activeRequests: number } };
const positive = (value: string | undefined, fallback: number) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private database: Observation = { state: 'unknown', observedAt: null, detail: 'Aguardando medição' };
  private worker: Observation = { state: 'unknown', observedAt: null, detail: 'Worker não configurado' };
  private lastPersistedAt: string | null = null;
  private storageError = '';
  private cpuPercent: number | null = null;
  constructor(private readonly prisma: PrismaService, private readonly metrics: ApiMetrics) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.MONITORING_ENABLED === '0') return;
    void this.collect();
    this.timer = setInterval(() => void this.collect(), 30000);
    this.timer.unref();
  }
  async onModuleDestroy() { clearInterval(this.timer); await this.pending; }

  collect(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.sample().catch(() => {
      this.storageError = 'Não foi possível persistir a telemetria.';
      this.logger.warn(this.storageError);
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async sample() {
    const observations = await Promise.allSettled([this.probeDatabase(), this.probeWorker(), si.currentLoad()]);
    if (observations[2].status === 'fulfilled') this.cpuPercent = observations[2].value.currentLoad;
    const worker = observations[1].status === 'fulfilled' ? observations[1].value : null;
    await this.persist([...this.metrics.snapshot().buckets, ...(worker?.metrics.buckets || [])]);
    await this.prisma.$executeRaw`DELETE FROM request_metric_minute WHERE ctid IN (SELECT ctid FROM request_metric_minute WHERE bucket_at < now()-interval '7 days' LIMIT 5000)`;
    this.lastPersistedAt = new Date().toISOString();
    this.storageError = '';
  }

  private async probeDatabase() {
    const started = performance.now();
    const observedAt = new Date().toISOString();
    let timeout: ReturnType<typeof setTimeout>;
    try {
      const result = await Promise.race([
        this.prisma.$queryRaw<{ active: number; idle: number; limit: number }[]>`
          SELECT count(*) FILTER (WHERE state='active')::int AS active,
            count(*) FILTER (WHERE state='idle')::int AS idle,
            current_setting('max_connections')::int AS "limit"
          FROM pg_stat_activity WHERE datname=current_database()`,
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), 2000); }),
      ]);
      const latencyMs = performance.now() - started;
      this.database = { state: latencyMs > 1000 ? 'degraded' : 'operational', observedAt, detail: 'Consulta PostgreSQL concluída', latencyMs, ...result[0] };
    } catch {
      this.database = { state: 'unavailable', observedAt, detail: 'Banco sem resposta em até dois segundos' };
    } finally { clearTimeout(timeout!); }
  }

  private async probeWorker(): Promise<WorkerObservation | null> {
    const base = process.env.FIELD_WORKER_INTERNAL_URL;
    if (!base || !process.env.API_KEY_SECRET) {
      this.worker = { state: 'unknown', observedAt: null, detail: 'Endereço interno ou chave do worker não configurados' };
      return null;
    }
    const started = performance.now(), observedAt = new Date().toISOString();
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/internal/metrics`, {
        headers: { 'x-api-key': process.env.API_KEY_SECRET }, signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new Error('unavailable');
      const result = await response.json() as WorkerObservation;
      if (!result.metrics || !Array.isArray(result.metrics.buckets) || !result.health) throw new Error('invalid');
      const degraded = result.health.readModelEnabled && !result.health.listenerConnected;
      this.worker = { state: degraded ? 'degraded' : 'operational', observedAt,
        detail: degraded ? 'Listener desconectado; verificação periódica permanece ativa' : 'Worker respondendo',
        latencyMs: performance.now() - started, ...result.health, instanceId: result.metrics.instanceId };
      return result;
    } catch {
      this.worker = { state: 'unavailable', observedAt, detail: 'Worker sem resposta autenticada em até dois segundos' };
      return null;
    }
  }

  async persist(buckets: MetricBucket[]) {
    if (!buckets.length) return;
    await this.prisma.$executeRaw`
      INSERT INTO request_metric_minute(bucket_at,component,instance_id,category,requests,errors,client_errors,aborted,total_ms,max_ms,histogram,revision)
      SELECT "bucketAt",component,"instanceId",category,requests,errors,"clientErrors",aborted,"totalMs","maxMs",histogram,revision
      FROM jsonb_to_recordset(${JSON.stringify(buckets)}::jsonb) AS r("bucketAt" timestamptz,component text,"instanceId" text,category text,
        requests int,errors int,"clientErrors" int,aborted int,"totalMs" float8,"maxMs" float8,histogram int[],revision int)
      ON CONFLICT (bucket_at,component,instance_id,category) DO UPDATE SET
        requests=EXCLUDED.requests,errors=EXCLUDED.errors,client_errors=EXCLUDED.client_errors,aborted=EXCLUDED.aborted,
        total_ms=EXCLUDED.total_ms,max_ms=EXCLUDED.max_ms,histogram=EXCLUDED.histogram,revision=EXCLUDED.revision,updated_at=now()
      WHERE EXCLUDED.revision > request_metric_minute.revision`;
  }

  async report(period = '24h') {
    const windows: Record<string, number> = { '15m': 15 * 60000, '1h': 3600000, '24h': 86400000, '7d': 7 * 86400000 };
    if (!Object.prototype.hasOwnProperty.call(windows, period)) throw new BadRequestException('Período técnico inválido.');
    const now = Date.now(), from = new Date(now - windows[period]);
    let rows: MetricBucket[] = [], queryError = '';
    try {
      const result = await this.prisma.$queryRaw<(Omit<MetricBucket, 'bucketAt'> & { bucketAt: Date })[]>`
        SELECT bucket_at AS "bucketAt",component,instance_id AS "instanceId",category,requests,errors,client_errors AS "clientErrors",
          aborted,total_ms AS "totalMs",max_ms AS "maxMs",histogram,revision
        FROM request_metric_minute WHERE bucket_at >= ${new Date(Math.min(+from, now - 5 * 60000))} AND bucket_at < ${new Date(now)} ORDER BY bucket_at`;
      rows = result.map(row => ({ ...row, bucketAt: row.bucketAt.toISOString() }));
    } catch { queryError = 'Histórico técnico indisponível.'; }
    const recent = rows.filter(row => Date.parse(row.bucketAt) >= now - 5 * 60000 && row.category !== 'field_poll');
    const selected = rows.filter(row => Date.parse(row.bucketAt) >= +from);
    const operations = selected.filter(row => row.category !== 'field_poll');
    const groupMs = windows[period] > 86400000 ? 3600000 : windows[period] > 3600000 ? 15 * 60000 : 60000;
    const groups = new Map<string, MetricBucket[]>();
    for (const row of selected) {
      const slot = Math.floor(Date.parse(row.bucketAt) / groupMs) * groupMs;
      const key = `${slot}:${row.category === 'field_poll' ? 'poll' : 'operation'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    const technicalAlerts: { kind: string; severity: 'warning' | 'critical'; message: string }[] = [];
    const latest = summarizeMetrics(recent);
    const minimum = positive(process.env.MONITORING_MIN_REQUESTS, 20);
    if (latest.requests >= minimum && (latest.p95Ms || 0) > positive(process.env.MONITORING_LATENCY_MS, 1000)) technicalAlerts.push({ kind: 'latency', severity: 'warning', message: 'Latência p95 das operações acima do limite nos últimos cinco minutos.' });
    if (latest.requests >= minimum && (latest.errorRate || 0) >= positive(process.env.MONITORING_ERROR_PERCENT, 5)) technicalAlerts.push({ kind: 'errors', severity: 'critical', message: 'Taxa de erros 5xx acima do limite nos últimos cinco minutos.' });
    const stale = !this.lastPersistedAt || now - Date.parse(this.lastPersistedAt) > 90000;
    const age = (observation: Observation): Observation => observation.observedAt && now - Date.parse(observation.observedAt) > 90000
      ? { ...observation, state: 'unknown', detail: 'Última medição desatualizada' } : observation;
    const database = age(this.database), worker = age(this.worker);
    for (const [kind, service] of Object.entries({ database, worker })) {
      if (service.state === 'unavailable' || service.state === 'degraded') technicalAlerts.push({ kind, severity: service.state === 'unavailable' ? 'critical' : 'warning', message: service.detail });
    }
    if (stale) technicalAlerts.push({ kind: 'collection', severity: 'warning', message: 'Coleta técnica ausente ou atrasada.' });
    const totalMemory = os.totalmem(), usedMemory = totalMemory - os.freemem();
    return {
      generatedAt: new Date(now).toISOString(), from: from.toISOString(), to: new Date(now).toISOString(), period,
      services: { api: { state: 'operational', observedAt: new Date(now).toISOString(), detail: 'Esta instância da API respondeu', instanceId: this.metrics.instanceId }, database, worker },
      collection: { lastPersistedAt: this.lastPersistedAt, stale, error: queryError || this.storageError, retentionDays: 7 },
      summary: summarizeMetrics(operations), polling: summarizeMetrics(selected.filter(row => row.category === 'field_poll')),
      categories: [...new Set(selected.map(row => `${row.component}:${row.category}`))].map(key => {
        const [component, category] = key.split(':');
        return { component, category, ...summarizeMetrics(selected.filter(row => row.component === component && row.category === category)) };
      }),
      series: [...groups.entries()].map(([key, values]) => ({ at: new Date(Number(key.split(':')[0])).toISOString(), kind: key.endsWith(':poll') ? 'poll' : 'operation', ...summarizeMetrics(values) })),
      resources: { scope: 'Ambiente visível ao processo da API', uptimeSeconds: os.uptime(), cpuPercent: this.cpuPercent, memoryPercent: usedMemory / totalMemory * 100,
        totalMemoryMb: totalMemory / 1048576, usedMemoryMb: usedMemory / 1048576, apiRssMb: process.memoryUsage().rss / 1048576, loadAverage: os.loadavg() },
      alerts: technicalAlerts,
    };
  }
}
