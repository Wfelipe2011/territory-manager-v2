import * as jwt from 'jsonwebtoken';
import { envs } from 'src/infra/envs';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { Role } from 'src/enum/role.enum';
import { Request } from 'express';
import { signature as Signature } from '@prisma/client';
import { CatalogRoundService } from '../round/catalog-round.service';

export type FieldPrincipal = {
  id: string;
  tenantId: number;
  territoryId: number;
  blockId?: number;
  round?: number | string | null;
  roles: Role[];
  exp?: number;
  overseer?: string;
};

@Injectable()
export class FieldAccessService {
  private readonly contexts = new WeakMap<Request, { user: FieldPrincipal; signature: Signature; scopes: Set<string> }>();

  validatedRequest(user: FieldPrincipal, request?: Request) {
    const context = request && this.contexts.get(request);
    return context?.user === user ? context.signature : undefined;
  }

  async scopeInRequest(user: FieldPrincipal, input: Parameters<FieldAccessService['scope']>[1], request?: Request) {
    const fields = ['territoryId', 'blockId', 'addressId', 'houseId', 'round', 'territoryBlockAddressId'] as const;
    const targets = fields.filter(key => input?.[key] !== undefined);
    if (!targets.length) return;
    const key = targets.map(field => `${field}:${Number(input[field])}`).join('|');
    const context = request && this.contexts.get(request);
    if (context?.user === user && context.scopes.has(key)) return;
    await this.scope(user, input);
    if (context?.user === user) context.scopes.add(key);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly rounds: CatalogRoundService
  ) {}

  async validate(user: FieldPrincipal) {
    const signature = await this.prisma.signature.findFirst({
      where: { key: user.id, tenantId: user.tenantId, expirationDate: { gt: new Date() } },
    });
    if (!signature) throw new ForbiddenException('Link inválido ou expirado');
    let grant: FieldPrincipal;
    try {
      grant = jwt.verify(signature.token, envs.JWT_SECRET) as FieldPrincipal;
    } catch {
      throw new ForbiddenException('Acesso não permitido');
    }
    if (
      grant.id !== user.id ||
      grant.tenantId !== user.tenantId ||
      grant.territoryId !== user.territoryId ||
      grant.blockId !== user.blockId ||
      (grant.round == null ? null : +grant.round) !== (user.round == null ? null : +user.round) ||
      grant.roles.join(',') !== user.roles.join(',')
    )
      throw new ForbiddenException('Acesso não permitido');
    const territory = await this.prisma.territory.findFirst({ where: { id: user.territoryId, tenantId: user.tenantId } });
    if (!territory) throw new ForbiddenException('Acesso não permitido');
    if (
      user.blockId &&
      !(await this.prisma.territory_block.findFirst({
        where: { tenantId: user.tenantId, territoryId: user.territoryId, blockId: user.blockId, registrationStatus: { not: 'rejected' } },
      }))
    )
      throw new ForbiddenException('Quadra indisponível ou rejeitada');
    return signature;
  }

  async scope(
    user: FieldPrincipal,
    input: { territoryId?: unknown; blockId?: unknown; addressId?: unknown; houseId?: unknown; round?: unknown; territoryBlockAddressId?: unknown }
  ) {
    const number = (value: unknown) => {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < 1) throw new BadRequestException('Identificador inválido');
      return n;
    };
    if (input.territoryId !== undefined && number(input.territoryId) !== user.territoryId) throw new ForbiddenException('Território não permitido');
    if (input.round !== undefined) {
      const selected = user.round == null ? (await this.rounds.resolve(user.tenantId, user.territoryId))?.roundNumber : +user.round;
      if (number(input.round) !== selected) throw new ForbiddenException('Rodada não permitida');
    }
    const blockId = input.blockId === undefined ? user.blockId : number(input.blockId);
    if (user.roles.includes(Role.PUBLICADOR) && blockId !== user.blockId) throw new ForbiddenException('Quadra não permitida');
    if (blockId !== undefined) {
      const block = await this.prisma.territory_block.findFirst({
        where: { tenantId: user.tenantId, territoryId: user.territoryId, blockId, registrationStatus: { not: 'rejected' } },
      });
      if (!block) throw new ForbiddenException('Quadra não permitida');
    }
    if (input.addressId !== undefined) {
      const addressId = number(input.addressId);
      const linked = await this.prisma.territory_block_address.findFirst({
        where: {
          tenantId: user.tenantId,
          addressId,
          registrationStatus: { not: 'rejected' },
          territoryBlock: { territoryId: user.territoryId, registrationStatus: { not: 'rejected' }, ...(blockId ? { blockId } : {}) },
        },
      });
      // Legacy imports may not have a normalized mapping yet.
      const legacy =
        linked ||
        (await this.prisma.house.findFirst({
          where: {
            tenantId: user.tenantId,
            territoryId: user.territoryId,
            registrationStatus: { not: 'rejected' },
            territoryBlockAddressId: null,
            ...(blockId ? { blockId } : {}),
            addressId,
          },
        }));
      if (!legacy) throw new ForbiddenException('Rua não permitida');
    }
    if (input.houseId !== undefined) {
      const house = await this.prisma.house.findFirst({
        where: {
          id: number(input.houseId),
          tenantId: user.tenantId,
          territoryId: user.territoryId,
          registrationStatus: { not: 'rejected' },
          ...(blockId ? { blockId } : {}),
          ...(input.addressId !== undefined ? { addressId: number(input.addressId) } : {}),
        },
      });
      if (!house) throw new NotFoundException('Casa não encontrada');
    }
    if (input.territoryBlockAddressId !== undefined) {
      const mapping = await this.prisma.territory_block_address.findFirst({
        where: {
          id: number(input.territoryBlockAddressId),
          tenantId: user.tenantId,
          ...(input.addressId !== undefined ? { addressId: number(input.addressId) } : {}),
          territoryBlock: { territoryId: user.territoryId, ...(blockId ? { blockId } : {}) },
        },
      });
      if (!mapping) throw new ForbiddenException('Endereço não permitido');
    }
  }

  async request(user: FieldPrincipal, req: Request) {
    const signature = await this.validate(user);
    this.contexts.set(req, { user, signature, scopes: new Set() });
    const body = req.body ?? {};
    // Check BOTH sources, rather than letting body/query overwrite path constraints.
    for (const input of [req.params, req.query, body]) await this.scopeInRequest(user, input, req);
    if (req.path.startsWith('/v1/reports') && body.id !== undefined) await this.scopeInRequest(user, { ...body, houseId: body.id }, req);
  }
}
