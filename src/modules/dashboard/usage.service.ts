import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ConcurrencyParams, ConcurrencyService } from './concurrency.service';

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService, private readonly concurrency: ConcurrencyService) {}

  async getUsage(params: ConcurrencyParams & { tenantId?: string }) {
    const tenantId = params.tenantId ? Number(params.tenantId) : null;
    if (tenantId !== null && (!Number.isSafeInteger(tenantId) || tenantId < 1)) throw new BadRequestException('Congregação inválida.');
    const history = await this.concurrency.history(params);
    const from = new Date(history.from), to = new Date(history.to);
    const tenants = await this.prisma.$queryRaw<{
      id: number; name: string; city: string; state: string; houses: number; territories: number;
      registeredUsers: number; openRounds: number; closedRounds: number; pendingRequests: number;
      completedHouses: number; operationalActivity: number; lastActivity: Date | null;
    }[]>`
      WITH houses AS (SELECT tenant_id,count(*)::int AS n FROM house WHERE registration_status='approved' GROUP BY tenant_id),
      territories AS (SELECT tenant_id,count(*)::int AS n FROM territory GROUP BY tenant_id),
      users AS (SELECT tenant_id,count(*)::int AS n FROM "user" GROUP BY tenant_id),
      rounds AS (
        SELECT tenant_id,count(*) FILTER(WHERE status='open')::int AS open,
          count(*) FILTER(WHERE closed_at>=${from} AND closed_at<${to})::int AS closed
        FROM round_info GROUP BY tenant_id
      ), requests AS (SELECT tenant_id,count(*) FILTER(WHERE status='pending')::int AS pending FROM change_request GROUP BY tenant_id),
      activity AS (
        SELECT tenant_id,
          count(*) FILTER(WHERE completed=true AND completed_date>=${from} AND completed_date<${to})::int AS completed,
          count(*) FILTER(WHERE greatest(update_date,completed_date,end_date,start_date)>=${from}
            AND greatest(update_date,completed_date,end_date,start_date)<${to})::int AS changed,
          max(greatest(update_date,completed_date,end_date,start_date)) AS last
        FROM round GROUP BY tenant_id
      )
      SELECT m.id,m.name,m.city,m.state,coalesce(h.n,0) AS houses,coalesce(t.n,0) AS territories,
        coalesce(u.n,0) AS "registeredUsers",coalesce(r.open,0) AS "openRounds",coalesce(r.closed,0) AS "closedRounds",
        coalesce(q.pending,0) AS "pendingRequests",coalesce(a.completed,0) AS "completedHouses",
        coalesce(a.changed,0) AS "operationalActivity",a.last AS "lastActivity"
      FROM multi_tenancy m LEFT JOIN houses h ON h.tenant_id=m.id LEFT JOIN territories t ON t.tenant_id=m.id
      LEFT JOIN users u ON u.tenant_id=m.id LEFT JOIN rounds r ON r.tenant_id=m.id
      LEFT JOIN requests q ON q.tenant_id=m.id LEFT JOIN activity a ON a.tenant_id=m.id ORDER BY m.name,m.id`;
    if (tenantId !== null && !tenants.some(t => t.id === tenantId)) throw new BadRequestException('Congregação não encontrada.');
    const summarize = (rows: typeof history.sessionsGeneral) => {
      const samples = rows.reduce((n, r) => n + r.samples, 0);
      const peak = rows.reduce<typeof rows[number] | null>((best, r) => !best || r.active > best.active || (r.active === best.active && r.peakAt < best.peakAt) ? r : best, null);
      return { samples, average: samples ? Number((rows.reduce((n, r) => n + r.average * r.samples, 0) / samples).toFixed(2)) : null,
        peak: peak?.active ?? null, peakAt: peak?.peakAt ?? null };
    };
    const enriched = tenants.map(t => ({ ...t,
      ...summarize(history.sessionsByTenant.filter(r => r.tenantId === t.id)),
      online: history.onlineByTenant.find(r => r.scope_id === t.id)?.active || 0,
      fieldActivity: history.sessionsByTenant.some(r => r.tenantId === t.id && r.active > 0),
    }));
    const selected = tenantId === null ? enriched : enriched.filter(t => t.id === tenantId);
    const series = tenantId === null ? history.sessionsGeneral : history.sessionsByTenant.filter(r => r.tenantId === tenantId);
    const sum = (key: 'houses'|'territories'|'registeredUsers'|'openRounds'|'closedRounds'|'pendingRequests'|'completedHouses') => selected.reduce((n,t) => n+t[key],0);
    const cities = new Map<string, { city: string; state: string; congregations: number; active: number; online: number }>();
    for (const t of selected) {
      const key = JSON.stringify([t.city,t.state]);
      const city = cities.get(key) || { city: t.city || 'Não informada', state: t.state || '—', congregations: 0, active: 0, online: 0 };
      city.congregations++; city.active += Number(t.fieldActivity || t.operationalActivity > 0); city.online += t.online;
      cities.set(key,city);
    }
    return {
      scope: tenantId, from: history.from, to: history.to, generatedAt: new Date().toISOString(),
      lastCollectedAt: history.lastCollectedAt, resolutionSeconds: history.resolutionSeconds, groupSeconds: history.groupSeconds,
      options: tenants.map(t => ({ id:t.id,name:t.name,city:t.city,state:t.state })),
      summary: { ...summarize(series), online: tenantId === null ? history.online : selected[0].online,
        congregations: selected.length, activeCongregations: selected.filter(t => t.fieldActivity || t.operationalActivity>0).length,
        houses:sum('houses'), territories:sum('territories'), registeredUsers:sum('registeredUsers'),
        openRounds:sum('openRounds'), closedRounds:sum('closedRounds'), pendingRequests:sum('pendingRequests'), completedHouses:sum('completedHouses') },
      series, tenants:selected, cities:[...cities.values()].sort((a,b)=>b.active-a.active || b.online-a.online),
    };
  }
}
