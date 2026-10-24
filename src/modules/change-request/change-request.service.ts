import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChangeEntity, ChangeAction, ChangeStatus, Prisma, change_request } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { Role } from 'src/enum/role.enum';
import { FieldAccessService, FieldPrincipal } from '../field/field-access.service';
import { CatalogRoundService } from '../round/catalog-round.service';
import { CreateChangeRequest } from './contracts';

type Tx = Prisma.TransactionClient;
export type Actor = {
  tenantId: number;
  roles: Role[];
  userId?: number;
  userName?: string;
  id?: string;
  overseer?: string;
  territoryId?: number;
  blockId?: number;
  round?: number | string | null;
};
export type ReviewItem = { id: number; version: number; impactToken?: string };
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const norm = (value: string) => value.trim().replace(/\s+/g, ' ');
const canonical = (value: any): any =>
  value instanceof Date ? value.toISOString() : Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map(key => [key, canonical(value[key])])
      )
    : value;
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const houseFields = ['number', 'legend', 'dontVisit', 'phone', 'complement', 'order'] as const;

@Injectable()
export class ChangeRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FieldAccessService,
    private readonly rounds: CatalogRoundService
  ) {}
  isAdmin(actor: Actor) {
    return actor.roles.includes(Role.ADMIN) || actor.roles.includes(Role.SUPER_ADMIN);
  }

  private async lock(tx: Tx, tenantId: number, territoryIds: number[] = []) {
    await tx.$queryRaw`SELECT id FROM multi_tenancy WHERE id=${tenantId} FOR UPDATE`;
    for (const id of [...new Set(territoryIds)].sort((a, b) => a - b))
      await tx.$queryRaw`SELECT id FROM territory WHERE tenant_id=${tenantId} AND id=${id} FOR UPDATE`;
  }
  private where(actor: Actor): Prisma.change_requestWhereInput {
    return {
      tenantId: actor.tenantId,
      ...(!this.isAdmin(actor)
        ? { territoryId: actor.territoryId, ...(actor.roles.includes(Role.PUBLICADOR) ? { blockId: actor.blockId, entity: ChangeEntity.house } : {}) }
        : {}),
    };
  }
  private data(entity: ChangeEntity, input: Record<string, unknown>, action: ChangeAction): Record<string, any> {
    const allowed = entity === 'house' ? [...houseFields] : entity === 'street' ? ['name', 'zipCode'] : ['name'];
    if (Object.keys(input).some(key => !allowed.includes(key as never))) throw new BadRequestException('Campo não permitido na proposta');
    if (action === 'delete') return {};
    const required = entity === 'house' ? 'number' : 'name';
    if (typeof input[required] !== 'string' || !norm(input[required] as string) || (input[required] as string).length > (entity === 'house' ? 30 : 150))
      throw new BadRequestException('Nome/número inválido');
    if (entity !== 'house') {
      if (input.zipCode != null && (typeof input.zipCode !== 'string' || !/^\d{5}-?\d{3}$/.test(input.zipCode))) throw new BadRequestException('CEP inválido');
      return { name: norm(input.name as string), ...(entity === 'street' ? { zipCode: input.zipCode ? String(input.zipCode).replace(/\D/g, '') : null } : {}) };
    }
    if (input.dontVisit != null && typeof input.dontVisit !== 'boolean') throw new BadRequestException('Não bater inválido');
    if (input.order != null && (!Number.isSafeInteger(input.order) || Number(input.order) < 0)) throw new BadRequestException('Ordem inválida');
    for (const key of ['legend', 'phone', 'complement'])
      if (input[key] != null && (typeof input[key] !== 'string' || String(input[key]).length > 200)) throw new BadRequestException('Dados da casa inválidos');
    return {
      number: norm(input.number as string).toUpperCase(),
      legend: input.legend == null ? 'Residência' : norm(String(input.legend)),
      dontVisit: input.dontVisit === true,
      phone: input.phone == null ? null : norm(String(input.phone)),
      complement: input.complement == null ? null : norm(String(input.complement)),
      order: input.order == null ? null : Number(input.order),
    };
  }
  private basicHouse(house: any) {
    return Object.fromEntries(houseFields.map(key => [key, house[key] ?? null]));
  }
  private async current(
    tx: Tx,
    request: { entity: ChangeEntity; targetId?: number | null; tenantId: number; territoryId: number; blockId?: number | null }
  ): Promise<any | null> {
    const { tenantId, territoryId, blockId, targetId } = request;
    if (!targetId) return null;
    if (request.entity === 'house') {
      const h = await tx.house.findFirst({ where: { id: targetId, tenantId, territoryId, blockId: blockId ?? undefined } });
      return h && { id: h.id, territoryId: h.territoryId, blockId: h.blockId, addressId: h.addressId, ...this.basicHouse(h) };
    }
    if (request.entity === 'street') {
      const tba = await tx.territory_block_address.findFirst({
        where: { id: targetId, tenantId, territoryBlock: { territoryId, blockId: blockId ?? undefined } },
        include: { address: true },
      });
      return tba && { id: tba.id, addressId: tba.addressId, name: tba.address.name, zipCode: tba.address.zipCode };
    }
    const tb = await tx.territory_block.findFirst({ where: { tenantId, territoryId, blockId: targetId }, include: { block: true } });
    return tb && { id: tb.blockId, name: tb.block.name };
  }
  private async visible(actor: Actor, id: number, tx: Tx = this.prisma) {
    const row = await tx.change_request.findFirst({ where: { ...this.where(actor), id } });
    if (!row) throw new NotFoundException('Solicitação não encontrada');
    return row;
  }
  private async parent(tx: Tx, tenantId: number, entity: ChangeEntity, targetId: number, pending: boolean) {
    if (!pending) return null;
    const row = await tx.change_request.findFirst({ where: { tenantId, entity, targetId, action: 'create', status: 'pending' } });
    if (!row) throw new ConflictException('Cadastro provisório sem solicitação de origem');
    return row.id;
  }
  private async address(tx: Tx, tenantId: number, data: any) {
    return (
      (await tx.address.findFirst({ where: { tenantId, name: { equals: data.name, mode: 'insensitive' }, zipCode: data.zipCode }, orderBy: { id: 'asc' } })) ??
      tx.address.create({ data: { tenantId, name: data.name, zipCode: data.zipCode } })
    );
  }

  async create(actor: Actor, input: CreateChangeRequest) {
    if (input.entity === 'block' && input.action !== 'create') throw new BadRequestException('Quadras permitem somente cadastro');
    // Updates are normalized after merging the live snapshot, preserving omitted fields.
    let data = input.action === 'update' ? input.data : this.data(input.entity, input.data, input.action);
    if (!input.observations?.trim()) throw new BadRequestException('Informe uma justificativa');
    return this.prisma.$transaction(
      async tx => {
        await this.lock(tx, actor.tenantId, [input.territoryId]);
        const territory = await tx.territory.findFirst({ where: { id: input.territoryId, tenantId: actor.tenantId } });
        if (!territory) throw new NotFoundException('Território não encontrado');
        if (!this.isAdmin(actor)) {
          const grant = await this.access.validate(actor as FieldPrincipal);
          if (input.entity !== 'house' && (!actor.roles.includes(Role.DIRIGENTE) || !grant.canEditStructure))
            throw new ForbiddenException('Edição de quadras e ruas não habilitada neste link');
        }
        let blockId = input.blockId,
          addressId = input.addressId,
          targetId = input.targetId ?? input.houseId;
        let parentRequestId: number | null = null,
          beforeData: any = null;
        let blockName: string | undefined, streetName: string | undefined;
        let tb: any;
        if (input.entity !== 'block') {
          tb = await tx.territory_block.findFirst({ where: { tenantId: actor.tenantId, territoryId: territory.id, blockId }, include: { block: true } });
          if (!blockId || !tb || tb.registrationStatus === 'rejected') throw new NotFoundException('Quadra não encontrada');
          blockName = tb.block.name;
          if (input.entity === 'street') parentRequestId = await this.parent(tx, actor.tenantId, 'block', blockId, tb.registrationStatus === 'pending');
        }
        if (input.entity === 'house' || (input.entity === 'street' && input.action !== 'create')) {
          const mapping = await tx.territory_block_address.findFirst({
            where: { tenantId: actor.tenantId, territoryBlockId: tb.id, ...(input.entity === 'street' && targetId ? { id: targetId } : { addressId }) },
            include: { address: true },
          });
          if (!mapping || mapping.registrationStatus === 'rejected') throw new NotFoundException('Rua não encontrada');
          addressId = mapping.addressId;
          streetName = mapping.address.name;
          if (input.entity === 'house') parentRequestId = await this.parent(tx, actor.tenantId, 'street', mapping.id, mapping.registrationStatus === 'pending');
          else targetId = mapping.id;
        }
        if (!this.isAdmin(actor))
          await this.access.scope(actor as FieldPrincipal, {
            territoryId: territory.id,
            blockId,
            addressId,
            ...(input.entity === 'house' && input.action !== 'create' ? { houseId: targetId } : {}),
          });
        if (input.action !== 'create') {
          beforeData = await this.current(tx, { tenantId: actor.tenantId, territoryId: territory.id, blockId, targetId, entity: input.entity });
          if (!beforeData) throw new NotFoundException('Cadastro não encontrado');
          if (input.action === 'update')
            data = this.data(
              input.entity,
              { ...(input.entity === 'house' ? this.basicHouse(beforeData) : { name: beforeData.name, zipCode: beforeData.zipCode }), ...input.data },
              input.action
            );
          if (await tx.change_request.findFirst({ where: { tenantId: actor.tenantId, entity: input.entity, targetId, status: 'pending' } }))
            throw new ConflictException('Já existe uma solicitação pendente para este cadastro');
        }
        if (input.entity === 'block') {
          if (
            await tx.territory_block.findFirst({
              where: {
                tenantId: actor.tenantId,
                territoryId: territory.id,
                registrationStatus: { not: 'rejected' },
                block: { name: { equals: String(data.name), mode: 'insensitive' } },
              },
            })
          )
            throw new ConflictException('Quadra já cadastrada ou em análise');
          const block = await tx.block.create({ data: { tenantId: actor.tenantId, name: String(data.name) } });
          await tx.territory_block.create({ data: { tenantId: actor.tenantId, territoryId: territory.id, blockId: block.id, registrationStatus: 'pending' } });
          targetId = blockId = block.id;
          blockName = block.name;
        } else if (input.action === 'create' && input.entity === 'street') {
          if (
            await tx.territory_block_address.findFirst({
              where: {
                tenantId: actor.tenantId,
                territoryBlockId: tb.id,
                registrationStatus: { not: 'rejected' },
                address: { name: { equals: String(data.name), mode: 'insensitive' } },
              },
            })
          )
            throw new ConflictException('Rua já cadastrada ou em análise nesta quadra');
          const address = await this.address(tx, actor.tenantId, data);
          const mapping = await tx.territory_block_address.upsert({
            where: { territoryBlockId_addressId: { territoryBlockId: tb.id, addressId: address.id } },
            create: { tenantId: actor.tenantId, territoryBlockId: tb.id, addressId: address.id, registrationStatus: 'pending' },
            update: { registrationStatus: 'pending' },
          });
          targetId = mapping.id;
          addressId = address.id;
          streetName = address.name;
        } else if (input.action === 'create') {
          if (
            await tx.house.findFirst({
              where: {
                tenantId: actor.tenantId,
                territoryId: territory.id,
                blockId,
                addressId,
                registrationStatus: { not: 'rejected' },
                number: { equals: String(data.number), mode: 'insensitive' },
                complement: data.complement as string | null,
              },
            })
          )
            throw new ConflictException('Casa já cadastrada ou em análise');
          const mapping = await tx.territory_block_address.findFirstOrThrow({ where: { tenantId: actor.tenantId, territoryBlockId: tb.id, addressId } });
          const house = await tx.house.create({
            data: {
              ...data,
              number: String(data.number),
              tenantId: actor.tenantId,
              territoryId: territory.id,
              blockId: blockId!,
              addressId: addressId!,
              territoryBlockAddressId: mapping.id,
              registrationStatus: 'pending',
            },
          });
          targetId = house.id;
          await this.rounds.attachHouse(tx, actor.tenantId, house.id, { autoStart: true, round: actor.round });
        }
        const context = { territory: territory.name, block: blockName ?? null, street: streetName ?? null };
        return tx.change_request.create({
          data: {
            tenantId: actor.tenantId,
            territoryId: territory.id,
            blockId,
            addressId,
            targetId,
            parentRequestId,
            entity: input.entity,
            action: input.action,
            observations: input.observations.trim(),
            beforeData: beforeData ? json(beforeData) : Prisma.JsonNull,
            proposedData: json({ ...data, _context: context }),
            requestedByUserId: actor.userId ?? null,
            requestedByName: actor.overseer ?? actor.userName ?? (this.isAdmin(actor) ? 'Administrador' : 'Publicador'),
            sourceSignatureKey: this.isAdmin(actor) ? null : actor.id,
            history: json([{ event: 'created', at: new Date().toISOString(), userId: actor.userId ?? null }]),
          },
        });
      },
      { timeout: 30000 }
    );
  }

  async list(actor: Actor, query: Record<string, string> = {}) {
    const page = Math.max(1, Number(query.page) || 1),
      limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const where: Prisma.change_requestWhereInput = { ...this.where(actor) };
    if (query.status) {
      if (!Object.values(ChangeStatus).includes(query.status as ChangeStatus)) throw new BadRequestException('Situação inválida');
      where.status = query.status as ChangeStatus;
    }
    if (query.entity) {
      if (!Object.values(ChangeEntity).includes(query.entity as ChangeEntity)) throw new BadRequestException('Entidade inválida');
      if (!this.isAdmin(actor) && actor.roles.includes(Role.PUBLICADOR) && query.entity !== 'house') throw new ForbiddenException();
      where.entity = query.entity as ChangeEntity;
    }
    if (query.action) {
      if (!Object.values(ChangeAction).includes(query.action as ChangeAction)) throw new BadRequestException('Operação inválida');
      where.action = query.action as ChangeAction;
    }
    if (query.territoryId) {
      const id = Number(query.territoryId);
      if (!Number.isSafeInteger(id) || id < 1) throw new BadRequestException('Território inválido');
      if (!this.isAdmin(actor) && id !== actor.territoryId) throw new ForbiddenException();
      where.territoryId = id;
    }
    if (query.from || query.to) {
      const from = query.from ? new Date(query.from) : undefined,
        to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;
      if ((from && isNaN(+from)) || (to && isNaN(+to))) throw new BadRequestException('Período inválido');
      where.updatedAt = { gte: from, lte: to };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.change_request.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      this.prisma.change_request.count({ where }),
    ]);
    return { items, total, page, limit };
  }
  private async impact(tx: Tx, request: change_request) {
    if (request.action !== 'delete' && request.action !== 'create') return null;
    const houses =
      request.entity === 'house'
        ? await tx.house.findMany({ where: { id: request.targetId!, tenantId: request.tenantId }, select: { id: true } })
        : await tx.house.findMany({
            where: { tenantId: request.tenantId, territoryId: request.territoryId, blockId: request.blockId!, ...(request.entity === 'street' ? { addressId: request.addressId! } : {}) },
            select: { id: true },
          });
    const houseIds = houses.map(h => h.id).sort((a, b) => a - b);
    const rounds = await tx.round.findMany({ where: { tenantId: request.tenantId, houseId: { in: houseIds } }, select: { id: true, completed: true, completedDate: true, updateDate: true }, orderBy: { id: 'asc' } });
    return { houses: houseIds.length, rounds: rounds.length, token: hash([houseIds, rounds]) };
  }
  private async descendants(tx: Tx, actor: Actor, id: number) {
    const rows: change_request[] = [];
    let frontier = [id];
    while (frontier.length) {
      const next = await tx.change_request.findMany({ where: { ...this.where(actor), parentRequestId: { in: frontier } }, orderBy: { id: 'asc' } });
      rows.push(...next);
      frontier = next.map(r => r.id);
    }
    return rows;
  }
  async detail(actor: Actor, id: number) {
    const row = await this.visible(actor, id);
    const [current, impact, descendants] = await Promise.all([
      this.current(this.prisma, row),
      this.impact(this.prisma, row),
      this.descendants(this.prisma, actor, id),
    ]);
    const ancestors: change_request[] = [];
    let parent = row.parentRequestId;
    while (parent) {
      const p = await this.prisma.change_request.findFirst({
        where: {
          id: parent,
          tenantId: actor.tenantId,
          ...(!this.isAdmin(actor) ? { territoryId: actor.territoryId, ...(actor.roles.includes(Role.PUBLICADOR) ? { blockId: actor.blockId } : {}) } : {}),
        },
      });
      if (!p) throw new NotFoundException('Cadastro pai indisponível');
      ancestors.unshift(p);
      parent = p.parentRequestId;
    }
    return {
      ...row,
      current,
      impact,
      descendants,
      ancestors,
      conflict: row.status === 'pending' && (!current || (!row.isLegacy && row.action !== 'create' && hash(current) !== hash(row.beforeData))),
    };
  }
  async sync(actor: Actor, cursor: string | undefined, signal: AbortSignal) {
    const deadline = Date.now() + 25000;
    while (!signal.aborted) {
      if (!this.isAdmin(actor)) await this.access.validate(actor as FieldPrincipal);
      const tenant = await this.prisma.multitenancy.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { requestsRevision: true } });
      const revision = String(tenant.requestsRevision);
      if (!cursor || cursor !== revision || Date.now() >= deadline)
        return {
          cursor: revision,
          changed: cursor !== revision,
          pending: await this.prisma.change_request.count({ where: { ...this.where(actor), status: 'pending' } }),
        };
      await new Promise<void>(resolve => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, Math.min(2000, deadline - Date.now()));
        signal.addEventListener('abort', done, { once: true });
        if (signal.aborted) done();
      });
    }
    return undefined;
  }
  private async targetState(tx: Tx, row: change_request, status: 'approved' | 'rejected') {
    if (row.entity === 'block')
      return tx.territory_block.updateMany({
        where: { tenantId: row.tenantId, territoryId: row.territoryId, blockId: row.targetId! },
        data: { registrationStatus: status },
      });
    if (row.entity === 'street')
      return tx.territory_block_address.updateMany({ where: { id: row.targetId!, tenantId: row.tenantId }, data: { registrationStatus: status } });
    return tx.house.updateMany({ where: { id: row.targetId!, tenantId: row.tenantId }, data: { registrationStatus: status } });
  }
  private async deleteHouse(tx: Tx, tenantId: number, houseIds: number[]) {
    await tx.round.deleteMany({ where: { tenantId, houseId: { in: houseIds } } });
    await tx.house.deleteMany({ where: { tenantId, id: { in: houseIds } } });
  }
  private async deleteProvisional(tx: Tx, row: change_request) {
    if (row.entity === 'house') return this.deleteHouse(tx, row.tenantId, [row.targetId!]);
    const houses = await tx.house.findMany({ where: {
      tenantId: row.tenantId, territoryId: row.territoryId, blockId: row.blockId!,
      ...(row.entity === 'street' ? { addressId: row.addressId! } : {}),
    }, select: { id: true } });
    await this.deleteHouse(tx, row.tenantId, houses.map(h => h.id));
    const links = await tx.territory_block.findMany({ where: { tenantId: row.tenantId, territoryId: row.territoryId, blockId: row.blockId! }, select: { id: true } });
    await tx.territory_block_address.deleteMany({ where: { tenantId: row.tenantId, territoryBlockId: { in: links.map(l => l.id) }, ...(row.entity === 'street' ? { id: row.targetId! } : {}) } });
    if (row.entity === 'block') {
      await tx.territory_block.deleteMany({ where: { tenantId: row.tenantId, id: { in: links.map(l => l.id) } } });
      if (!(await tx.territory_block.count({ where: { blockId: row.blockId! } })) && !(await tx.house.count({ where: { blockId: row.blockId! } })))
        await tx.block.delete({ where: { id: row.blockId! } });
    }
  }
  private async apply(tx: Tx, row: change_request) {
    const data = row.proposedData as any;
    if (row.entity === 'block') {
      await this.targetState(tx, row, 'approved');
      return;
    }
    if (row.entity === 'house') {
      if (row.action === 'delete') {
        await this.deleteHouse(tx, row.tenantId, [row.targetId!]);
        return;
      }
      if (!row.isLegacy || row.action === 'update')
        await tx.house.update({
          where: { id: row.targetId! },
          data: { ...this.data('house', Object.fromEntries(houseFields.map(k => [k, data[k]])), 'update') },
        });
      await tx.house.update({
        where: { id: row.targetId! },
        data: { registrationStatus: 'approved', reportType: null, backupData: Prisma.JsonNull, observations: null },
      });
      await this.rounds.attachHouse(tx, row.tenantId, row.targetId!);
      if (row.action === 'create') {
        const house = await tx.house.findUniqueOrThrow({ where: { id: row.targetId! } });
        const ghosts = await tx.house.findMany({
          where: { tenantId: row.tenantId, territoryId: row.territoryId, blockId: row.blockId!, addressId: house.addressId, number: 'ghost' },
          select: { id: true },
        });
        await this.deleteHouse(
          tx,
          row.tenantId,
          ghosts.map(h => h.id)
        );
      }
      return;
    }
    const mapping = await tx.territory_block_address.findFirstOrThrow({
      where: { id: row.targetId!, tenantId: row.tenantId },
      include: { territoryBlock: true },
    });
    if (row.action === 'delete') {
      const houses = await tx.house.findMany({
        where: { tenantId: row.tenantId, territoryId: row.territoryId, blockId: row.blockId!, addressId: mapping.addressId },
        select: { id: true },
      });
      await this.deleteHouse(
        tx,
        row.tenantId,
        houses.map(h => h.id)
      );
      await tx.territory_block_address.delete({ where: { id: mapping.id } });
      if (
        !(await tx.territory_block_address.count({ where: { addressId: mapping.addressId } })) &&
        !(await tx.house.count({ where: { addressId: mapping.addressId } }))
      )
        await tx.address.delete({ where: { id: mapping.addressId } });
      return;
    }
    if (row.action === 'update') {
      const collision = await tx.territory_block_address.findFirst({
        where: {
          tenantId: row.tenantId,
          territoryBlockId: mapping.territoryBlockId,
          id: { not: mapping.id },
          registrationStatus: { not: 'rejected' },
          address: { name: { equals: data.name, mode: 'insensitive' } },
        },
      });
      if (collision) throw new ConflictException('Já existe uma rua com esse nome na quadra');
      const address = await this.address(tx, row.tenantId, data);
      await tx.territory_block_address.update({ where: { id: mapping.id }, data: { addressId: address.id } });
      await tx.house.updateMany({
        where: {
          tenantId: row.tenantId,
          territoryId: row.territoryId,
          blockId: row.blockId!,
          OR: [{ territoryBlockAddressId: mapping.id }, { territoryBlockAddressId: null, addressId: mapping.addressId }],
        },
        data: { addressId: address.id, territoryBlockAddressId: mapping.id },
      });
    }
    await this.targetState(tx, row, 'approved');
  }
  async review(actor: Actor, decision: 'approve' | 'reject', items: ReviewItem[], options: { reason?: string; confirmDeletion?: boolean } = {}) {
    if (!this.isAdmin(actor)) throw new ForbiddenException('Somente administradores podem revisar');
    if (
      !Array.isArray(items) ||
      !items.length ||
      items.length > 500 ||
      items.some(i => !Number.isSafeInteger(i.id) || i.id < 1 || !Number.isSafeInteger(i.version) || i.version < 1) ||
      new Set(items.map(i => i.id)).size !== items.length
    )
      throw new BadRequestException('Seleção de solicitações inválida');
    if (decision === 'reject' && (!options.reason?.trim() || options.reason.length > 1000)) throw new BadRequestException('Informe o motivo da rejeição');
    return this.prisma.$transaction(
      async tx => {
        await this.lock(tx, actor.tenantId);
        const rows = await tx.change_request.findMany({ where: { tenantId: actor.tenantId, id: { in: items.map(i => i.id) } } });
        if (rows.length !== items.length) throw new NotFoundException('Solicitação não encontrada');
        await this.lock(
          tx,
          actor.tenantId,
          rows.map(r => r.territoryId)
        );
        for (const row of rows)
          if (row.status !== 'pending' || row.version !== items.find(i => i.id === row.id)!.version)
            throw new ConflictException('Solicitação já revisada ou alterada. Atualize a tela.');
        // Existing administrative editors do not take the request lock. Lock targets
        // before reading their snapshots so an in-flight edit cannot be overwritten.
        const houseIds = rows.filter(r => r.entity === 'house' && r.targetId).map(r => r.targetId!);
        const streetIds = rows.filter(r => r.entity === 'street' && r.targetId).map(r => r.targetId!);
        const addressIds = rows.filter(r => r.entity === 'street' && r.addressId).map(r => r.addressId!);
        if (houseIds.length)
          await tx.$queryRaw`SELECT id FROM house WHERE tenant_id=${actor.tenantId} AND id IN (${Prisma.join(houseIds)}) ORDER BY id FOR UPDATE`;
        if (streetIds.length)
          await tx.$queryRaw`SELECT id FROM territory_block_address WHERE tenant_id=${actor.tenantId} AND id IN (${Prisma.join(
            streetIds
          )}) ORDER BY id FOR UPDATE`;
        if (addressIds.length)
          await tx.$queryRaw`SELECT id FROM address WHERE tenant_id=${actor.tenantId} AND id IN (${Prisma.join(addressIds)}) ORDER BY id FOR UPDATE`;
        const depth = (r: change_request, seen = new Set<number>()): number => {
          if (!r.parentRequestId) return 0;
          if (seen.has(r.id)) throw new ConflictException('Dependência inválida');
          seen.add(r.id);
          const p = rows.find(p => p.id === r.parentRequestId);
          return p ? depth(p, seen) + 1 : 0;
        };
        rows.sort((a, b) => depth(a) - depth(b) || a.id - b.id);
        const processed = new Set<number>();
        for (const row of rows) {
          if (processed.has(row.id)) continue;
          if (decision === 'approve') {
            if (row.parentRequestId && (await tx.change_request.findUniqueOrThrow({ where: { id: row.parentRequestId } })).status !== 'approved')
              throw new ConflictException('Aprove primeiro os cadastros pais ou inclua-os no lote');
            const current = await this.current(tx, row);
            if (!current || (!row.isLegacy && row.action !== 'create' && hash(current) !== hash(row.beforeData)))
              throw new ConflictException('Cadastro alterado ou removido desde a solicitação');
          }
          const removes = decision === 'approve' ? row.action === 'delete' : row.action === 'create';
          if (removes) {
            // Serialize the impact check with house clicks, which update round rows.
            await tx.$queryRaw`SELECT id FROM round WHERE tenant_id=${row.tenantId} AND territory_id=${row.territoryId}
              AND (${row.entity === 'house'} OR block_id=${row.blockId ?? 0})
              AND (${row.entity !== 'house'} OR house_id=${row.targetId ?? 0}) ORDER BY id FOR UPDATE`;
            const impact = await this.impact(tx, row);
            if (!options.confirmDeletion || items.find(i => i.id === row.id)!.impactToken !== impact?.token)
              throw new ConflictException('Confirme o impacto atualizado da exclusão');
          }
          if (decision === 'approve') await this.apply(tx, row);
          else if (row.isLegacy) {
            if (row.action === 'create') await this.deleteHouse(tx, row.tenantId, [row.targetId!]);
            else {
              const backup = row.beforeData as any;
              if (!backup || typeof backup.number !== 'string') throw new ConflictException('Backup legado inválido; revisão manual necessária');
              await tx.house.update({
                where: { id: row.targetId! },
                data: {
                  ...this.data('house', Object.fromEntries(houseFields.map(k => [k, backup[k]])), 'update'),
                  reportType: null,
                  backupData: Prisma.JsonNull,
                  observations: null,
                },
              });
            }
          } else if (row.action === 'create') await this.deleteProvisional(tx, row);
          const now = new Date();
          await tx.change_request.update({
            where: { id: row.id },
            data: {
              status: decision === 'approve' ? 'approved' : 'rejected',
              version: { increment: 1 },
              reviewerId: actor.userId,
              reviewedAt: now,
              reviewReason: decision === 'reject' ? options.reason!.trim() : null,
              history: json([
                ...(Array.isArray(row.history) ? row.history : []),
                { event: decision, at: now.toISOString(), userId: actor.userId ?? null, reason: options.reason ?? null },
              ]),
            },
          });
          processed.add(row.id);
          if (decision === 'approve' && row.entity === 'street' && row.action === 'delete') {
            const removed = await tx.change_request.findMany({
              where: {
                tenantId: actor.tenantId,
                territoryId: row.territoryId,
                blockId: row.blockId,
                addressId: row.addressId,
                status: 'pending',
                id: { not: row.id },
              },
            });
            for (const child of removed) {
              await tx.change_request.update({
                where: { id: child.id },
                data: {
                  status: 'rejected',
                  version: { increment: 1 },
                  reviewerId: actor.userId,
                  reviewedAt: now,
                  reviewReason: 'Rua excluída pelo administrador',
                  history: json([...(Array.isArray(child.history) ? child.history : []), { event: 'target_removed', at: now.toISOString(), parentId: row.id }]),
                },
              });
              processed.add(child.id);
            }
          }
          if (decision === 'reject' && row.action === 'create') {
            for (const child of await this.descendants(tx, actor, row.id)) {
              if (child.status !== 'pending') continue;
              await tx.change_request.update({
                where: { id: child.id },
                data: {
                  status: 'rejected',
                  version: { increment: 1 },
                  reviewerId: actor.userId,
                  reviewedAt: now,
                  reviewReason: `Cadastro pai rejeitado: ${options.reason}`,
                  history: json([
                    ...(Array.isArray(child.history) ? child.history : []),
                    { event: 'parent_rejected', parentId: row.id, at: now.toISOString() },
                  ]),
                },
              });
              processed.add(child.id);
            }
          }
        }
        return { reviewed: rows.length };
      },
      { timeout: 120000 }
    );
  }
}
