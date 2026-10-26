import { randomUUID } from 'crypto';

export const LATENCY_BOUNDS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, Infinity];
export type MetricBucket = {
  bucketAt: string; component: string; instanceId: string; category: string;
  requests: number; errors: number; clientErrors: number; aborted: number;
  totalMs: number; maxMs: number; histogram: number[]; revision: number;
};
export type MetricsSnapshot = { instanceId: string; startedAt: string; buckets: MetricBucket[] };

/** Fixed categories deliberately contain no URLs, identifiers or request contents. */
export function requestCategory(method: string, path: string): string | null {
  if (method === 'OPTIONS' || !path.startsWith('/v1/') || /\/dashboard(?:\/|\?|$)|\/health-check|\/sessions(?:\?|$)/.test(path)) return null;
  if (/\/field\/(?:blocks\/[^/]+\/)?sync(?:\?|$)/.test(path)) return /[?&]cursor=/.test(path) ? 'field_poll' : 'field_initial';
  if (/\/signature\/|\/login(?:\?|$)/.test(path)) return 'access';
  return ['GET', 'HEAD'].includes(method) ? 'read' : 'write';
}

export class RequestMetrics {
  readonly instanceId = randomUUID();
  readonly startedAt = new Date().toISOString();
  private readonly buckets = new Map<string, MetricBucket>();
  constructor(readonly component: 'api' | 'worker', readonly enabled = process.env.REQUEST_METRICS_ENABLED !== '0') {}

  record(category: string | null, ms: number, status: number, aborted = false, now = Date.now()) {
    if (!this.enabled || !category) return;
    const bucketAt = new Date(Math.floor(now / 60000) * 60000).toISOString();
    const key = `${bucketAt}:${category}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { bucketAt, component: this.component, instanceId: this.instanceId, category,
        requests: 0, errors: 0, clientErrors: 0, aborted: 0, totalMs: 0, maxMs: 0,
        histogram: LATENCY_BOUNDS.map(() => 0), revision: 0 };
      this.buckets.set(key, bucket);
      this.prune(now);
    }
    bucket.revision++;
    if (aborted) { bucket.aborted++; return; }
    bucket.requests++; bucket.errors += Number(status >= 500); bucket.clientErrors += Number(status >= 400 && status < 500);
    bucket.totalMs += Math.max(0, ms); bucket.maxMs = Math.max(bucket.maxMs, ms);
    bucket.histogram[LATENCY_BOUNDS.findIndex(bound => ms <= bound)]++;
  }

  snapshot(now = Date.now()): MetricsSnapshot {
    this.prune(now);
    return { instanceId: this.instanceId, startedAt: this.startedAt,
      buckets: [...this.buckets.values()].map(bucket => ({ ...bucket, histogram: [...bucket.histogram] })) };
  }
  private prune(now: number) {
    for (const [key, bucket] of this.buckets) if (Date.parse(bucket.bucketAt) < now - 15 * 60000) this.buckets.delete(key);
  }
}

export function summarizeMetrics(rows: MetricBucket[]) {
  const sum = (key: 'requests' | 'errors' | 'clientErrors' | 'aborted' | 'totalMs') => rows.reduce((total, row) => total + Number(row[key]), 0);
  const requests = sum('requests'), errors = sum('errors');
  const histogram = LATENCY_BOUNDS.map((_, i) => rows.reduce((total, row) => total + (row.histogram[i] || 0), 0));
  let cumulative = 0, p95: number | null = null;
  if (requests) {
    const index = histogram.findIndex(count => (cumulative += count) >= Math.ceil(requests * .95));
    p95 = Number.isFinite(LATENCY_BOUNDS[index]) ? LATENCY_BOUNDS[index] : Math.max(...rows.map(row => row.maxMs));
  }
  return { requests, errors, clientErrors: sum('clientErrors'), aborted: sum('aborted'),
    errorRate: requests ? errors / requests * 100 : null,
    averageMs: requests ? sum('totalMs') / requests : null, p95Ms: p95 };
}
