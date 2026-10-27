import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { Role } from 'src/enum/role.enum';
import { pairSuggestion } from './pair-suggestion';
import { housePermissions, unmarkHours } from '../house/house-permissions';
import { FieldAccessService, FieldPrincipal } from './field-access.service';
import { CatalogRoundService } from '../round/catalog-round.service';

export type FieldQuery = { scope?: string; blockId?: string; addressId?: string; cursor?: string; clientId?: string; tabId?: string };
type Scope = {
  scope: 'territory' | 'block' | 'street';
  blockId?: number;
  addressId?: number;
  fullBlock?: boolean;
  round: number | null;
  hours: number;
  canEditStructure: boolean;
};

@Injectable()
export class FieldService {
  private readonly numericCollator = new Intl.Collator('pt-BR', { numeric: true });
  private readonly diagnostics = process.env.FIELD_PERF_DIAGNOSTICS === '1';
  private readonly logger = new Logger(FieldService.name);
  private readonly checkInterval = Math.max(100, Math.min(25000, Number(process.env.FIELD_POLL_CHECK_MS) || 2000));
  private readonly revisions = new Map<string, { expires: number; value: Promise<string> }>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FieldAccessService,
    private readonly rounds: CatalogRoundService
  ) {}
  private async scope(user: FieldPrincipal, query: FieldQuery, fullBlock: boolean, request?: Request): Promise<Scope> {
    const scope = query.scope ?? (user.roles.includes(Role.PUBLICADOR) ? 'block' : 'territory');
    if (!['territory', 'block', 'street'].includes(scope)) throw new BadRequestException('Escopo inválido');
    if (scope === 'territory' && user.roles.includes(Role.PUBLICADOR)) throw new ForbiddenException('Território não permitido');
    const blockId = query.blockId === undefined ? user.blockId : Number(query.blockId),
      addressId = query.addressId === undefined ? undefined : Number(query.addressId);
    if (scope !== 'territory' && (!blockId || !Number.isSafeInteger(blockId) || blockId < 1)) throw new BadRequestException('Quadra inválida');
    if (scope === 'street' && (!addressId || !Number.isSafeInteger(addressId) || addressId < 1)) throw new BadRequestException('Rua inválida');
    await this.access.scopeInRequest(user, { blockId, addressId }, request);
    const [info, setting, signature] = await Promise.all([
      this.rounds.resolve(user.tenantId, user.territoryId, user.round),
      this.prisma.parameter.findUnique({ where: { tenantId_key: { tenantId: user.tenantId, key: 'SIGNATURE_EXPIRATION_HOURS' } } }),
      this.access.validatedRequest(user, request) ?? this.access.validate(user),
    ]);
    return {
      scope: scope as Scope['scope'],
      blockId: scope === 'territory' ? undefined : blockId,
      addressId: scope === 'street' ? addressId : undefined,
      fullBlock,
      round: info?.roundNumber ?? null,
      hours: unmarkHours(setting?.value ?? null),
      canEditStructure: user.roles.includes(Role.DIRIGENTE) && signature.canEditStructure,
    };
  }
  private async revision(user: FieldPrincipal, scope: Scope, tx: Prisma.TransactionClient = this.prisma) {
    const rows = await tx.$queryRaw<{ round_number: number; revision: bigint }[]>`SELECT round_number,revision FROM field_revision WHERE tenant_id=${
      user.tenantId
    } AND territory_id=${user.territoryId} AND block_id=${scope.blockId ?? 0} AND round_number IN (0,${scope.round ?? 0})`;
    return `c:${String(rows.find(r => r.round_number === 0)?.revision ?? 0)}:r:${scope.round ?? 0}:${String(
      rows.find(r => r.round_number === scope.round)?.revision ?? 0
    )}:p:${scope.hours}:e:${scope.canEditStructure ? 1 : 0}`;
  }
  private currentRevision(user: FieldPrincipal, scope: Scope) {
    const key = `${user.tenantId}:${user.territoryId}:${scope.round ?? 0}:${scope.blockId ?? 0}:${scope.hours}:${scope.canEditStructure}`;
    const cached = this.revisions.get(key);
    if (cached && cached.expires > Date.now()) return { key, entry: cached };
    const entry = { value: this.revision(user, scope), expires: Date.now() + Math.min(1900, this.checkInterval) };
    this.revisions.set(key, entry);
    entry.value.catch(() => { if (this.revisions.get(key) === entry) this.revisions.delete(key); });
    return { key, entry };
  }
  private identity(query: FieldQuery) {
    const valid = (v?: string) => typeof v === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(v);
    if (!valid(query.clientId) || !valid(query.tabId)) throw new BadRequestException('Sessão inválida');
    return { clientId: query.clientId!, tabId: query.tabId! };
  }
  private async heartbeat(user: FieldPrincipal, query: FieldQuery, scope: Scope) {
    const { clientId, tabId } = this.identity(query);
    await this.prisma.$transaction([
      this.prisma.$executeRaw`UPDATE field_session SET disconnected_at=LEAST(now(),last_seen_at+interval '60 seconds') WHERE tenant_id=${
        user.tenantId
      } AND client_id=${clientId} AND tab_id=${tabId} AND disconnected_at IS NULL AND (last_seen_at<=now()-interval '60 seconds' OR signature_key<>${
        user.id
      } OR block_id IS DISTINCT FROM ${scope.blockId ?? null}::integer OR address_id IS DISTINCT FROM ${scope.addressId ?? null}::integer OR round_number<>${
        scope.round ?? 0
      })`,
      this.prisma.$executeRaw`INSERT INTO field_session(tenant_id,territory_id,round_number,block_id,address_id,client_id,tab_id,signature_key) VALUES(${
        user.tenantId
      },${user.territoryId},${scope.round ?? 0},${scope.blockId ?? null},${scope.addressId ?? null},${clientId},${tabId},${
        user.id
      }) ON CONFLICT(tenant_id,client_id,tab_id) WHERE disconnected_at IS NULL DO UPDATE SET last_seen_at=now()`,
    ]);
  }
  async leave(user: FieldPrincipal, query: FieldQuery) {
    const { clientId, tabId } = this.identity(query);
    await this.prisma
      .$executeRaw`UPDATE field_session SET disconnected_at=now() WHERE tenant_id=${user.tenantId} AND signature_key=${user.id} AND client_id=${clientId} AND tab_id=${tabId} AND disconnected_at IS NULL`;
  }
  private async presence(user: FieldPrincipal, scope: Scope) {
    const rows = await this.prisma.$queryRaw<
      { client_id: string; block_id: number | null; address_id: number | null }[]
    >`SELECT DISTINCT fs.client_id,fs.block_id,fs.address_id FROM field_session fs JOIN signature s ON s.key=fs.signature_key AND s.tenant_id=fs.tenant_id WHERE fs.tenant_id=${
      user.tenantId
    } AND fs.territory_id=${user.territoryId} AND fs.round_number=${
      scope.round ?? 0
    } AND fs.last_seen_at>now()-interval '60 seconds' AND fs.disconnected_at IS NULL AND s.expiration_date>now() ${
      user.roles.includes(Role.PUBLICADOR) ? Prisma.sql`AND fs.block_id=${user.blockId}` : Prisma.empty
    }`;
    const blocks: Record<string, Set<string>> = {},
      streets: Record<string, Set<string>> = {};
    for (const row of rows) {
      if (row.block_id) (blocks[row.block_id] ??= new Set()).add(row.client_id);
      if (row.address_id) (streets[`${row.block_id}:${row.address_id}`] ??= new Set()).add(row.client_id);
    }
    return {
      total: new Set(rows.map(r => r.client_id)).size,
      blocks: Object.fromEntries(Object.entries(blocks).map(([k, s]) => [k, s.size])),
      streets: Object.fromEntries(Object.entries(streets).map(([k, s]) => [k, s.size])),
    };
  }
  async poll(user: FieldPrincipal, query: FieldQuery, signal: AbortSignal, fullBlock = false, request?: Request) {
    const started = performance.now();
    const timing = { event: 'field_sync', preparationMs: 0, snapshotMs: 0, waitMs: 0, revisionChecks: 0, outcome: 'error' };
    try {
      const scope = await this.scope(user, query, fullBlock, request);
      await this.heartbeat(user, query, scope);
      timing.preparationMs = performance.now() - started;
      const deadline = Date.now() + 25000;
      while (!signal.aborted) {
        const signature = await this.access.validate(user);
        scope.canEditStructure = user.roles.includes(Role.DIRIGENTE) && signature.canEditStructure;
        const { key, entry } = this.currentRevision(user, scope);
        const revision = await entry.value;
        timing.revisionChecks++;
        if (query.cursor === undefined || query.cursor !== revision) {
          const snapshotStarted = performance.now();
          const snapshot = await this.prisma.$transaction(
            async tx => {
              const info = await this.rounds.resolve(user.tenantId, user.territoryId, user.round, tx);
              const setting = await tx.parameter.findUnique({ where: { tenantId_key: { tenantId: user.tenantId, key: 'SIGNATURE_EXPIRATION_HOURS' } } });
              scope.round = info?.roundNumber ?? null;
              scope.hours = unmarkHours(setting?.value ?? null);
              return { cursor: await this.revision(user, scope, tx), data: await this.snapshot(tx, user, scope, info) };
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
          );
          timing.snapshotMs = performance.now() - snapshotStarted;
          // A newer transactional snapshot must not be followed by the old cached revision.
          if (snapshot.cursor !== revision && this.revisions.get(key) === entry) this.revisions.delete(key);
          await this.access.validate(user);
          const presence = await this.presence(user, scope);
          timing.outcome = 'changed';
          return { ...snapshot, changed: true, presence };
        }
        if (Date.now() >= deadline) {
          timing.outcome = 'timeout';
          return { cursor: revision, changed: false, presence: await this.presence(user, scope) };
        }
        const waitStarted = performance.now();
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, Math.min(this.checkInterval, deadline - Date.now()));
          signal.addEventListener('abort', done, { once: true });
          if (signal.aborted) done();
        });
        timing.waitMs += performance.now() - waitStarted;
      }
      timing.outcome = 'aborted';
      return undefined;
    } finally {
      if (this.diagnostics) this.logger.warn(JSON.stringify({ ...timing, elapsedMs: performance.now() - started }));
    }
  }
  private async snapshot(tx: Prisma.TransactionClient, user: FieldPrincipal, scope: Scope, info: Awaited<ReturnType<CatalogRoundService['resolve']>>) {
    const snapshotStarted = performance.now();
    const [territory, tenancy, links, requests] = await Promise.all([
      tx.territory.findFirstOrThrow({ where: { id: user.territoryId, tenantId: user.tenantId }, select: { id: true, name: true, imageUrl: true } }),
      tx.multitenancy.findUniqueOrThrow({ where: { id: user.tenantId }, select: { name: true, city: true, state: true, phone: true } }),
      tx.territory_block.findMany({
        where: {
          tenantId: user.tenantId,
          territoryId: user.territoryId,
          registrationStatus: { not: 'rejected' },
          ...(scope.blockId ? { blockId: scope.blockId } : {}),
        },
        include: {
          block: { select: { id: true, name: true } },
          blockSignatures: { where: { tenantId: user.tenantId, roundNumber: user.round == null ? 0 : +user.round }, include: { signature: { select: { key: true, expirationDate: true, token: true } } } },
          territory_block_address: { where: { registrationStatus: { not: 'rejected' } }, include: { address: true } },
        },
        orderBy: { block: { name: 'asc' } },
      }),
      tx.change_request.findMany({
        where: { tenantId: user.tenantId, territoryId: user.territoryId, status: 'pending', ...(scope.blockId ? { blockId: scope.blockId } : {}) },
        select: { id: true, entity: true, action: true, targetId: true },
      }),
    ]);
    const metadataFinished = performance.now();
    const houses = await tx.house.findMany({
      where: {
        tenantId: user.tenantId,
        territoryId: user.territoryId,
        blockId: { in: links.map(l => l.blockId) },
        registrationStatus: { not: 'rejected' },
        number: { not: 'ghost' },
        OR: [{ territoryBlockAddressId: null }, { territoryBlockAddressId: { in: links.flatMap(link => link.territory_block_address.map(mapping => mapping.id)) } }],
      },
      select: {
        id: true,
        number: true,
        legend: true,
        dontVisit: true,
        complement: true,
        order: true,
        addressId: true,
        blockId: true,
        registrationStatus: true,
        territoryBlockAddressId: true,
        address: { select: { name: true } },
        rounds: { where: { roundNumber: scope.round ?? -1 }, take: 1, select: { completed: true, completedDate: true, endDate: true, leaveLetter: true } },
      },
    });
    const housesFinished = performance.now();
    const pending = new Map(requests.map(r => [`${r.entity}:${r.targetId}`, { id: r.id, action: r.action }]));
    const mapped = houses
      .map(h => {
        const link = links.find(l => l.blockId === h.blockId)!;
        const mapping = link.territory_block_address.find(a => a.id === h.territoryBlockAddressId || a.addressId === h.addressId);
        const round = h.rounds[0];
        const published =
          h.registrationStatus !== 'rejected' && link.registrationStatus !== 'rejected' && (!mapping || mapping.registrationStatus !== 'rejected');
        const hasRound = !!round && published;
        return {
          id: h.id,
          number: h.number,
          legend: h.legend,
          dontVisit: h.dontVisit,
          complement: h.complement,
          order: h.order,
          addressId: h.addressId,
          blockId: h.blockId,
          addressName: h.address.name,
          registrationStatus: h.registrationStatus,
          pendingRequest: pending.get(`house:${h.id}`) ?? null,
          reportType: null,
          hasRound,
          status: hasRound ? round.completed : false,
          leaveLetter: hasRound ? round.leaveLetter : false,
          readOnly: !hasRound || !!round?.endDate || info?.status === 'closed',
          completedDate: round?.completedDate ?? null,
          ...housePermissions(
            {
              completed: hasRound ? round.completed : false,
              completedDate: round?.completedDate ?? null,
              endDate: info?.status === 'closed' ? info.closedAt ?? new Date() : round?.endDate ?? null,
              dontVisit: h.dontVisit,
              reportType: null,
              hasRound,
              published,
            },
            scope.hours
          ),
        };
      })
      .sort(
        (a, b) =>
          (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
          this.numericCollator.compare(a.number, b.number) ||
          a.id - b.id
      );
    const mappedFinished = performance.now();
    const blocks = links.map(link => {
      const rows = mapped.filter(h => h.blockId === link.blockId),
        work = rows.filter(h => h.hasRound),
        completed = work.filter(h => h.status).length;
      let signature: { key: string; expirationDate: Date | null } | null = null;
      const grant = link.blockSignatures[0]?.signature;
      if (!user.roles.includes(Role.PUBLICADOR) && grant?.expirationDate && grant.expirationDate > new Date()) {
        const payload = jwt.decode(grant.token) as { round: number | null } | null;
        if (payload && (payload.round == null ? null : +payload.round) === (user.round == null ? null : +user.round))
          signature = { key: grant.key, expirationDate: grant.expirationDate };
      }
      const dates = work.flatMap(h => (h.completedDate ? [+h.completedDate] : []));
      return {
        id: link.blockId,
        name: link.block.name,
        registrationStatus: link.registrationStatus,
        pendingRequest: pending.get(`block:${link.blockId}`) ?? null,
        total: work.length,
        catalogTotal: rows.length,
        withoutRound: rows.length - work.length,
        completed,
        pending: work.length - completed,
        lastWorkedAt: dates.length ? new Date(Math.max(...dates)) : null,
        signature,
        ...pairSuggestion(work.length - completed),
      };
    });
    const streetMap = new Map<number, { id: number; mappingId: number | null; name: string; zipCode: string | null; registrationStatus: string }>();
    for (const link of links)
      for (const mapping of link.territory_block_address)
        streetMap.set(mapping.addressId, {
          id: mapping.addressId,
          mappingId: mapping.id,
          name: mapping.address.name,
          zipCode: mapping.address.zipCode,
          registrationStatus: mapping.registrationStatus,
        });
    for (const h of mapped)
      if (!streetMap.has(h.addressId))
        streetMap.set(h.addressId, { id: h.addressId, mappingId: null, name: h.addressName, zipCode: null, registrationStatus: 'approved' });
    const byAddress = new Map<number, typeof mapped>();
    for (const h of mapped) {
      if (!byAddress.has(h.addressId)) byAddress.set(h.addressId, []);
      byAddress.get(h.addressId)!.push(h);
    }
    const streets = [...streetMap.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .map(street => {
        const rows = byAddress.get(street.id) ?? [],
          work = rows.filter(h => h.hasRound),
          completed = work.filter(h => h.status).length,
          numbers = rows.map(h => h.number).sort((a, b) => this.numericCollator.compare(a, b));
        return {
          ...street,
          completed,
          pending: work.length - completed,
          total: work.length,
          catalogTotal: rows.length,
          withoutRound: rows.length - work.length,
          pendingRequest: pending.get(`street:${street.mappingId}`) ?? null,
          firstNumber: numbers[0] ?? null,
          lastNumber: numbers[numbers.length - 1] ?? null,
          numbers,
          houses: rows.map(({ blockId, addressId, addressName, order, completedDate, ...house }) => house),
        };
      });
    const context = {
      territory,
      tenancy,
      roundInfo: info ?? { name: 'Cadastro de endereços', theme: 'default', colorPrimary: null, colorSecondary: null },
      workRoundNumber: scope.round,
      capabilities: { canEditStructure: scope.canEditStructure, canReportHouses: true },
      block: blocks.find(b => b.id === scope.blockId) ?? null,
    };
    if (this.diagnostics) this.logger.warn(JSON.stringify({ event: 'field_snapshot', metadataMs: metadataFinished - snapshotStarted, housesMs: housesFinished - metadataFinished, mappingMs: mappedFinished - housesFinished, assemblyMs: performance.now() - mappedFinished, houses: houses.length, blocks: links.length }));
    if (scope.fullBlock) return { ...context, streets: streets.map(({ numbers, ...street }) => street) };
    return {
      ...context,
      blocks,
      streets: scope.scope === 'territory' ? [] : streets.map(({ houses, ...street }) => street),
      houses: scope.scope === 'street' ? mapped.filter(h => h.addressId === scope.addressId) : [],
      street: scope.addressId ? streetMap.get(scope.addressId) ?? null : null,
    };
  }
  async getConnectedSessionCount() {
    const rows = await this.prisma.$queryRaw<
      { count: number }[]
    >`SELECT count(DISTINCT fs.client_id)::int AS count FROM field_session fs JOIN signature s ON s.key=fs.signature_key AND s.tenant_id=fs.tenant_id WHERE fs.disconnected_at IS NULL AND fs.last_seen_at>now()-interval '60 seconds' AND s.expiration_date>now()`;
    return rows[0].count;
  }
  @Cron(CronExpression.EVERY_30_SECONDS)
  async cleanup() {
    await this.prisma
      .$executeRaw`UPDATE field_session SET disconnected_at=last_seen_at+interval '60 seconds' WHERE disconnected_at IS NULL AND last_seen_at<=now()-interval '60 seconds'`;
    for (const [k, v] of this.revisions) if (v.expires < Date.now()) this.revisions.delete(k);
  }
}
