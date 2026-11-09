import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { Role } from 'src/enum/role.enum';
import { FieldAccessService, FieldPrincipal } from '../field/field-access.service';
import type { Actor } from './change-request.service';

type Tx = Prisma.TransactionClient;
export type Entry = { id: number; mappingId: number | null; name: string; status: string; position: number | null };
@Injectable()
export class StreetOrderService {
  constructor(private readonly prisma: PrismaService, private readonly access: FieldAccessService) {}
  private admin(actor: Actor) { return actor.roles.includes(Role.ADMIN) || actor.roles.includes(Role.SUPER_ADMIN); }
  async authorize(actor: Actor, territoryId: number, blockId: number) {
    if (!this.admin(actor)) {
      const signature = await this.access.validate(actor as FieldPrincipal);
      if (!actor.roles.includes(Role.DIRIGENTE) || !signature.canEditStructure) throw new ForbiddenException('Edição estrutural não habilitada');
      await this.access.scope(actor as FieldPrincipal, { territoryId, blockId });
    }
  }
  async lock(tx: Tx, tenantId: number, territoryId: number) {
    await tx.$queryRaw`SELECT id FROM multi_tenancy WHERE id=${tenantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM territory WHERE id=${territoryId} AND tenant_id=${tenantId} FOR UPDATE`;
  }
  async snapshot(tx: Tx, tenantId: number, territoryId: number, blockId: number): Promise<Entry[]> {
    const link = await tx.territory_block.findFirst({ where: { tenantId, territoryId, blockId, registrationStatus: { not: 'rejected' } }, include: { territory_block_address: { include: { address: true } } } });
    if (!link) throw new NotFoundException('Quadra não encontrada');
    if (link.territory_block_address.some(m => m.tenantId !== tenantId || m.address.tenantId !== tenantId)) throw new ConflictException('Rua inconsistente; contate o administrador');
    const entries: Entry[] = link.territory_block_address.filter(m => m.registrationStatus !== 'rejected').map(m => ({ id: m.addressId, mappingId: m.id, name: m.address.name, status: m.registrationStatus, position: m.position }));
    const legacy = await tx.house.findMany({ where: { tenantId, territoryId, blockId, territoryBlockAddressId: null, registrationStatus: { not: 'rejected' }, number: { not: 'ghost' } }, select: { addressId: true, address: { select: { name: true, tenantId: true } } } });
    for (const h of legacy) {
      if (h.address.tenantId !== tenantId) throw new ConflictException('Rua legada inconsistente; contate o administrador');
      const existing = link.territory_block_address.find(m => m.addressId === h.addressId);
      if (existing?.registrationStatus === 'rejected') throw new ConflictException('Rua legada inconsistente; contate o administrador');
      if (!entries.some(e => e.id === h.addressId)) entries.push({ id: h.addressId, mappingId: null, name: h.address.name, status: 'approved', position: null });
    }
    return entries.sort((a,b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, 'pt-BR') || a.id - b.id);
  }
  same(expected: Entry[] | undefined, current: Entry[]) {
    if (!Array.isArray(expected)) return false;
    const normalize = (items: Entry[]) => items.map(e => ({ id: e?.id, mappingId: e?.mappingId ?? null, name: e?.name, status: e?.status, position: e?.position ?? null }));
    return JSON.stringify(normalize(expected)) === JSON.stringify(normalize(current));
  }

  // Preserve hidden provisional/legacy slots while replacing only the edited streets.
  async applyEdited(tx: Tx, tenantId: number, territoryId: number, blockId: number, before: Entry[], orderedMappings: number[]) {
    const current = await this.snapshot(tx, tenantId, territoryId, blockId);
    const editable = new Set(before.filter(e => e.mappingId && e.status === 'approved').map(e => e.mappingId));
    const remaining = [...orderedMappings];
    const ordered: Entry[] = [];
    for (const old of before) {
      const mappingId = editable.has(old.mappingId) ? remaining.shift() : old.mappingId;
      const entry = mappingId ? current.find(e => e.mappingId === mappingId) :
        !editable.has(old.mappingId) ? current.find(e => e.id === old.id && e.mappingId === null) : undefined;
      if (entry) ordered.push(entry);
    }
    for (const mappingId of remaining) {
      const entry = current.find(e => e.mappingId === mappingId);
      if (!entry) throw new ConflictException('Rua alterada durante o salvamento');
      ordered.push(entry);
    }
    for (const entry of current) if (!ordered.some(e => e.id === entry.id)) ordered.push(entry);
    await this.apply(tx, tenantId, territoryId, blockId, current, ordered.map(e => e.id));
  }

  async apply(tx: Tx, tenantId: number, territoryId: number, blockId: number, snapshot: Entry[], ordered: number[]) {
    const tb = await tx.territory_block.findFirstOrThrow({ where: { tenantId, territoryId, blockId } });
    for (const [index, id] of ordered.entries()) {
      const entry = snapshot.find(e => e.id === id)!;
      if (entry.mappingId) await tx.territory_block_address.update({ where: { id: entry.mappingId }, data: { position: index + 1 } });
      else await tx.territory_block_address.create({ data: { tenantId, territoryBlockId: tb.id, addressId: id, position: index + 1 } });
    }
  }
  async get(actor: Actor, territoryId: number, blockId: number) {
    await this.authorize(actor, territoryId, blockId);
    return this.snapshot(this.prisma, actor.tenantId, territoryId, blockId);
  }
  private pending(tx: Tx, tenantId: number, territoryId: number, blockId: number) {
    return tx.change_request.findFirst({ where: { tenantId, territoryId, blockId, status: 'pending', entity: 'block', action: 'update', proposedData: { path: ['_kind'], equals: 'street_order' } } });
  }
  async state(actor: Actor, territoryId: number, blockId: number) {
    await this.authorize(actor, territoryId, blockId);
    return this.prisma.$transaction(async tx => {
      const current = await this.snapshot(tx, actor.tenantId, territoryId, blockId);
      const pending = await this.pending(tx, actor.tenantId, territoryId, blockId);
      const owned = pending?.sourceSignatureKey === actor.id;
      return { current, pending: pending ? {
        id: pending.id, version: pending.version, editable: owned,
        conflict: !this.same(pending.beforeData as Entry[], current),
        ordered: owned ? (pending.proposedData as any).ordered as number[] : null,
      } : null };
    }, { isolationLevel: 'RepeatableRead' });
  }
  async save(actor: Actor, territoryId: number, blockId: number, expected: Entry[], ordered: number[], requestId?: number, version?: number) {
    await this.authorize(actor, territoryId, blockId);
    if (!Array.isArray(expected) || !Array.isArray(ordered) || expected.some(e => !e || !Number.isSafeInteger(e.id) || e.id < 1) || ordered.some(n => !Number.isSafeInteger(n) || n < 1) || new Set(expected.map(e => e.id)).size !== expected.length || new Set(ordered).size !== ordered.length) throw new BadRequestException('Lista de ruas inválida');
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, actor.tenantId, territoryId);
      const current = await this.snapshot(tx, actor.tenantId, territoryId, blockId);
      if (!this.same(expected, current) || ordered.length !== expected.length || ordered.some(id => !expected.some(e => e.id === id))) throw new ConflictException('A ordem ou as ruas foram alteradas. Atualize a tela.');
      if (this.admin(actor)) { await this.apply(tx, actor.tenantId, territoryId, blockId, current, ordered); return { applied: true }; }
      const pending = await this.pending(tx, actor.tenantId, territoryId, blockId);
      if (pending) {
        if (pending.sourceSignatureKey !== actor.id) throw new ConflictException('Outro dirigente já enviou uma ordem para esta quadra. Aguarde a revisão.');
        if (requestId !== pending.id || version !== pending.version) throw new ConflictException('A solicitação foi alterada. Atualize a tela.');
        if (!this.same(pending.beforeData as Entry[], current)) throw new ConflictException('As ruas foram alteradas. Aguarde a revisão e crie uma nova proposta.');
        return tx.change_request.update({ where: { id: pending.id }, data: {
          proposedData: { ...(pending.proposedData as Prisma.JsonObject), ordered }, version: { increment: 1 },
          history: [...(Array.isArray(pending.history) ? pending.history : []), { event: 'order_updated', at: new Date().toISOString() }],
        } });
      }
      if (requestId !== undefined || version !== undefined) throw new ConflictException('A solicitação já foi revisada. Atualize a tela.');
      const block = await tx.territory_block.findFirstOrThrow({ where: { tenantId: actor.tenantId, territoryId, blockId }, include: { block: true, territory: true } });
      const parent = block.registrationStatus === 'pending' ? await tx.change_request.findFirst({ where: { tenantId: actor.tenantId, entity: 'block', action: 'create', targetId: blockId, status: 'pending' } }) : null;
      if (block.registrationStatus === 'pending' && !parent) throw new ConflictException('Quadra provisória sem solicitação de origem');
      return tx.change_request.create({ data: { tenantId: actor.tenantId, territoryId, blockId, targetId: null, parentRequestId: parent?.id, entity: 'block', action: 'update', observations: 'Solicitação de alteração da ordem das ruas', beforeData: current as any, proposedData: { _kind: 'street_order', ordered, _context: { territory: block.territory.name, block: block.block.name } }, requestedByName: actor.overseer ?? 'Dirigente', sourceSignatureKey: actor.id, history: [{ event: 'created', at: new Date().toISOString() }] } });
    });
  }
}
