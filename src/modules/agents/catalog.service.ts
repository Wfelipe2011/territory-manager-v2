import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CatalogRoundService } from '../round/catalog-round.service';
import { AgentPrincipal, digest } from './agent.config';

type Tx = Prisma.TransactionClient;
const visibleHouse = { id: true, number: true, legend: true, dontVisit: true, territoryId: true, blockId: true, addressId: true, territoryBlockAddressId: true } as const;
const versioned = <T extends object>(row: T) => ({ ...row, version: digest(JSON.stringify(row)) });
const missing = () => { throw new NotFoundException('Cadastro não encontrado nesta congregação'); };

@Injectable()
export class AgentCatalogService {
  constructor(private readonly prisma: PrismaService, private readonly rounds: CatalogRoundService) {}

  async assertConnection(tx: Tx, principal: AgentPrincipal) {
    const connection = await tx.agent_connection.findFirst({ where: {
      id: principal.connectionId, userId: principal.userId, tenantId: principal.tenantId,
      clientId: principal.clientId, revokedAt: null, expiresAt: { gt: new Date() },
    } });
    const user = await tx.user.findFirst({ where: { id: principal.userId, tenantId: principal.tenantId } });
    if (!connection || !user || connection.credentialVersion !== digest(user.password)) throw new UnauthorizedException('Conexão revogada ou usuário alterado');
    return connection;
  }

  async execute(principal: AgentPrincipal, tool: string, input: any) {
    const write = /^(create|update)_/.test(tool);
    const scope = write ? 'catalog:write' : 'catalog:read';
    try {
      if (!principal.scopes.includes(scope)) throw new ForbiddenException('Permissão insuficiente');
      return await this.prisma.$transaction(async tx => {
        // Revocation and account changes cannot race a committed operation.
        await tx.$queryRaw`SELECT id FROM agent_connection WHERE id=${principal.connectionId} FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "user" WHERE id=${principal.userId} FOR SHARE`;
        const connection = await this.assertConnection(tx, principal);
        if (!connection.scopes.includes(scope)) throw new ForbiddenException('Permissão insuficiente');
        if (write) await tx.$queryRaw`SELECT id FROM multi_tenancy WHERE id=${principal.tenantId} FOR UPDATE`;
        const requestHash = digest(JSON.stringify({ tool, input }));
        if (write) {
          const prior = await tx.agent_operation.findUnique({ where: { connectionId_key: { connectionId: principal.connectionId, key: input.idempotencyKey } } });
          if (prior && prior.expiresAt > new Date()) {
            if (prior.requestHash !== requestHash) throw new ConflictException('Chave de idempotência já usada com outros dados');
            return prior.result;
          }
          if (prior) await tx.agent_operation.delete({ where: { connectionId_key: { connectionId: principal.connectionId, key: input.idempotencyKey } } });
        }
        const result = await this.dispatch(tx, principal, tool, input);
        const json = JSON.parse(JSON.stringify(result));
        if (write) await tx.agent_operation.create({ data: { connectionId: principal.connectionId, key: input.idempotencyKey, requestHash, result: json, expiresAt: new Date(Date.now() + 86400000) } });
        await tx.agent_audit.create({ data: {
          ...principalAudit(principal), tool, recordId: typeof json.id === 'number' ? json.id : undefined, outcome: 'success',
        } });
        return json;
      }, { timeout: 30000 });
    } catch (error) {
      await this.prisma.agent_audit.create({ data: { ...principalAudit(principal), tool, outcome: String(error?.getStatus?.() || 'error') } });
      throw error;
    }
  }

  private async territory(tx: Tx, tenantId: number, id: number) {
    const row = await tx.territory.findFirst({ where: { id, tenantId, type: { tenantId } }, select: { id: true, name: true, typeId: true } });
    return row || missing();
  }
  private async block(tx: Tx, tenantId: number, territoryId: number, id: number) {
    await this.territory(tx, tenantId, territoryId);
    const row = await tx.territory_block.findFirst({ where: { tenantId, territoryId, blockId: id, block: { tenantId }, registrationStatus: 'approved' }, include: { block: true } });
    return row || missing();
  }
  private async street(tx: Tx, tenantId: number, territoryId: number, blockId: number, id: number) {
    const tb = await this.block(tx, tenantId, territoryId, blockId);
    const row = await tx.territory_block_address.findFirst({ where: { id, tenantId, territoryBlockId: tb.id, address: { tenantId }, registrationStatus: 'approved' }, include: { address: true } });
    return row || missing();
  }
  private streetOutput(row: any) { return versioned({ id: row.id, addressId: row.addressId, territoryBlockId: row.territoryBlockId, name: row.address.name, zipCode: row.address.zipCode }); }
  private checkVersion(row: object, expectedVersion: string) {
    if (versioned(row).version !== expectedVersion) throw new ConflictException('Cadastro alterado. Consulte novamente antes de editar');
  }

  private async dispatch(tx: Tx, principal: AgentPrincipal, tool: string, p: any): Promise<any> {
    const tenantId = principal.tenantId;
    const page = p.page ?? 1;
    const limit = p.limit ?? 25;
    const pagination = { skip: (page - 1) * limit, take: limit };
    const search = p.search ? { name: { contains: p.search, mode: 'insensitive' as const } } : {};
    const pageResult = (data: any[], total: number) => ({ data, total, page, limit });
    switch (tool) {
      case 'connection_context': {
        const tenant = await tx.multitenancy.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
        return { congregation: tenant.name, permissions: principal.scopes };
      }
      case 'list_territory_types':
        return { data: await tx.type.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { id: 'asc' }, take: 100 }) };
      case 'list_territories': {
        const where = { tenantId, type: { tenantId }, ...search, ...(p.typeId ? { typeId: p.typeId } : {}) };
        const [data, total] = await Promise.all([tx.territory.findMany({ where, select: { id: true, name: true, typeId: true }, orderBy: { id: 'asc' }, ...pagination }), tx.territory.count({ where })]);
        return pageResult(data.map(versioned), total);
      }
      case 'get_territory': return versioned(await this.territory(tx, tenantId, p.id));
      case 'create_territory': {
        if (!await tx.type.findFirst({ where: { id: p.typeId, tenantId } })) missing();
        return versioned(await tx.territory.create({ data: { name: p.name, typeId: p.typeId, tenantId }, select: { id: true, name: true, typeId: true } }));
      }
      case 'update_territory': {
        await tx.$queryRaw`SELECT id FROM territory WHERE id=${p.id} AND tenant_id=${tenantId} FOR UPDATE`;
        const row = await this.territory(tx, tenantId, p.id);
        this.checkVersion(row, p.expectedVersion);
        if (p.typeId !== undefined && p.typeId !== row.typeId) {
          if (!await tx.type.findFirst({ where: { id: p.typeId, tenantId } })) missing();
          const inUse = await tx.house.count({ where: { tenantId, territoryId: row.id } }) + await tx.round.count({ where: { tenantId, territoryId: row.id } });
          if (inUse) throw new ConflictException('Tipo não pode mudar em território com casas ou histórico');
        }
        return versioned(await tx.territory.update({ where: { id: row.id, tenantId }, data: { name: p.name, typeId: p.typeId }, select: { id: true, name: true, typeId: true } }));
      }
      case 'list_blocks': {
        await this.territory(tx, tenantId, p.territoryId);
        const where = { tenantId, territoryId: p.territoryId, registrationStatus: 'approved' as const, block: { tenantId, ...search } };
        const [data, total] = await Promise.all([tx.territory_block.findMany({ where, include: { block: true }, orderBy: { id: 'asc' }, ...pagination }), tx.territory_block.count({ where })]);
        return pageResult(data.map(row => versioned({ id: row.blockId, name: row.block.name, territoryId: row.territoryId })), total);
      }
      case 'get_block': {
        const row = await this.block(tx, tenantId, p.territoryId, p.id);
        return versioned({ id: row.blockId, name: row.block.name, territoryId: row.territoryId });
      }
      case 'create_block': {
        await this.territory(tx, tenantId, p.territoryId);
        const block = await tx.block.create({ data: { name: p.name, tenantId } });
        await tx.territory_block.create({ data: { tenantId, territoryId: p.territoryId, blockId: block.id } });
        return versioned({ id: block.id, name: block.name, territoryId: p.territoryId });
      }
      case 'update_block': {
        await tx.$queryRaw`SELECT id FROM block WHERE id=${p.id} AND tenant_id=${tenantId} FOR UPDATE`;
        const row = await this.block(tx, tenantId, p.territoryId, p.id);
        this.checkVersion({ id: row.blockId, name: row.block.name, territoryId: row.territoryId }, p.expectedVersion);
        if (await tx.territory_block.count({ where: { tenantId, blockId: p.id } }) > 1) throw new ConflictException('Quadra compartilhada: edite os vínculos pelo Admin');
        await tx.block.update({ where: { id: p.id, tenantId }, data: { name: p.name } });
        return versioned({ id: p.id, name: p.name, territoryId: p.territoryId });
      }
      case 'list_streets': {
        const tb = await this.block(tx, tenantId, p.territoryId, p.blockId);
        const where = { tenantId, territoryBlockId: tb.id, registrationStatus: 'approved' as const, address: { tenantId, ...search } };
        const [data, total] = await Promise.all([tx.territory_block_address.findMany({ where, include: { address: true }, orderBy: { id: 'asc' }, ...pagination }), tx.territory_block_address.count({ where })]);
        return pageResult(data.map(row => this.streetOutput(row)), total);
      }
      case 'get_street': return this.streetOutput(await this.street(tx, tenantId, p.territoryId, p.blockId, p.id));
      case 'create_street': {
        const tb = await this.block(tx, tenantId, p.territoryId, p.blockId);
        let address = await tx.address.findFirst({ where: { tenantId, name: { equals: p.name, mode: 'insensitive' } } });
        if (!address) address = await tx.address.create({ data: { tenantId, name: p.name, zipCode: p.zipCode } });
        if (await tx.territory_block_address.findFirst({ where: { tenantId, territoryBlockId: tb.id, addressId: address.id } })) throw new ConflictException('Rua já vinculada à quadra');
        return this.streetOutput(await tx.territory_block_address.create({ data: { tenantId, territoryBlockId: tb.id, addressId: address.id }, include: { address: true } }));
      }
      case 'update_street': {
        await tx.$queryRaw`SELECT id FROM territory_block_address WHERE id=${p.id} AND tenant_id=${tenantId} FOR UPDATE`;
        const row = await this.street(tx, tenantId, p.territoryId, p.blockId, p.id);
        await tx.$queryRaw`SELECT id FROM address WHERE id=${row.addressId} AND tenant_id=${tenantId} FOR UPDATE`;
        const fresh = await this.street(tx, tenantId, p.territoryId, p.blockId, p.id);
        const { version, ...current } = this.streetOutput(fresh);
        this.checkVersion(current, p.expectedVersion);
        const name = p.name ?? fresh.address.name;
        const zipCode = p.zipCode === undefined ? fresh.address.zipCode : p.zipCode;
        // Address labels can be shared. Replace only this link, preserving houses and history.
        let target = await tx.address.findFirst({ where: { tenantId, name, zipCode } });
        if (!target) target = await tx.address.create({ data: { tenantId, name, zipCode } });
        const collision = await tx.territory_block_address.findFirst({ where: { tenantId, territoryBlockId: row.territoryBlockId, addressId: target.id, id: { not: row.id } } });
        if (collision) throw new ConflictException('Rua de destino já vinculada; mesclagem exige revisão no Admin');
        await tx.house.updateMany({ where: { tenantId, territoryId: p.territoryId, blockId: p.blockId, OR: [{ territoryBlockAddressId: row.id }, { territoryBlockAddressId: null, addressId: row.addressId }] }, data: { addressId: target.id, territoryBlockAddressId: row.id } });
        return this.streetOutput(await tx.territory_block_address.update({ where: { id: row.id, tenantId }, data: { addressId: target.id }, include: { address: true } }));
      }
      case 'list_houses': {
        const street = await this.street(tx, tenantId, p.territoryId, p.blockId, p.streetId);
        const where = { tenantId, territoryId: p.territoryId, blockId: p.blockId, addressId: street.addressId, territoryBlockAddressId: street.id, registrationStatus: 'approved' as const, number: { not: 'ghost', ...(p.search ? { contains: p.search } : {}) } };
        const [data, total] = await Promise.all([tx.house.findMany({ where, select: visibleHouse, orderBy: { id: 'asc' }, ...pagination }), tx.house.count({ where })]);
        return pageResult(data.map(versioned), total);
      }
      case 'get_house': {
        const row = await this.house(tx, tenantId, p.id);
        return versioned(row);
      }
      case 'create_house': {
        if (p.number.toLowerCase() === 'ghost') throw new BadRequestException('Número reservado');
        const street = await this.street(tx, tenantId, p.territoryId, p.blockId, p.streetId);
        if (await tx.house.findFirst({ where: { tenantId, territoryBlockAddressId: street.id, number: p.number } })) throw new ConflictException('Casa já cadastrada nesta rua');
        const row = await tx.house.create({ data: { tenantId, territoryId: p.territoryId, blockId: p.blockId, addressId: street.addressId, territoryBlockAddressId: street.id, number: p.number, legend: p.legend, dontVisit: p.dontVisit }, select: visibleHouse });
        const ghosts = await tx.house.findMany({ where: { tenantId, territoryBlockAddressId: street.id, number: 'ghost' }, select: { id: true } });
        if (ghosts.length) {
          const ids = ghosts.map(ghost => ghost.id);
          await tx.round.deleteMany({ where: { tenantId, houseId: { in: ids } } });
          await tx.house.deleteMany({ where: { tenantId, id: { in: ids }, number: 'ghost' } });
        }
        await this.rounds.attachHouse(tx, tenantId, row.id, { autoStart: true });
        const rounds = await tx.round.findMany({ where: { tenantId, houseId: row.id }, select: { roundNumber: true } });
        return { ...versioned(row), affectedRoundNumbers: rounds.map(r => r.roundNumber) };
      }
      case 'update_house': {
        await tx.$queryRaw`SELECT id FROM house WHERE id=${p.id} AND tenant_id=${tenantId} FOR UPDATE`;
        const row = await this.house(tx, tenantId, p.id);
        this.checkVersion(row, p.expectedVersion);
        if (p.number?.toLowerCase() === 'ghost') throw new BadRequestException('Número reservado');
        if (p.number && await tx.house.findFirst({ where: { tenantId, territoryBlockAddressId: row.territoryBlockAddressId, number: p.number, id: { not: row.id } } })) throw new ConflictException('Casa já cadastrada nesta rua');
        return versioned(await tx.house.update({ where: { id: p.id, tenantId }, data: { number: p.number, legend: p.legend, dontVisit: p.dontVisit }, select: visibleHouse }));
      }
      default: throw new BadRequestException('Ferramenta não suportada');
    }
  }

  private async house(tx: Tx, tenantId: number, id: number) {
    const row = await tx.house.findFirst({ where: { id, tenantId, registrationStatus: 'approved', number: { not: 'ghost' } }, select: visibleHouse });
    if (!row?.territoryBlockAddressId) return missing();
    const street = await this.street(tx, tenantId, row.territoryId, row.blockId, row.territoryBlockAddressId);
    if (street.addressId !== row.addressId) return missing();
    return row;
  }
}

function principalAudit(p: AgentPrincipal) { return { tenantId: p.tenantId, userId: p.userId, clientId: p.clientId, connectionId: p.connectionId }; }
