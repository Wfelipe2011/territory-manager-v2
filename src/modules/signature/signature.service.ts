import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { calculateExpiresIn } from 'src/shared';
import { randomInt } from 'crypto';
import { Prisma } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { envs } from 'src/infra/envs';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Role } from 'src/enum/role.enum';
import { SignatureDate } from './usecase/SignatureDate';
import { ParametersService } from '../parameters/parameters.service';
import { CatalogRoundService } from '../round/catalog-round.service';

type GenerateTerritoryParams = {
  canEditStructure?: boolean;
  overseer: string;
  expirationTime: string;
  territoryId: number;
  tenantId: number;
  round?: number | null;
};

type GenerateBlockParams = {
  parentSignature?: string;
  territoryId: number;
  blockId: number;
  tenantId: number;
  round?: number | null;
};

type TokenData = {
  id: string;
  overseer: string;
  territoryId: number;
  blockId: number;
  roles: Role[];
  round: number | string | null;
  tenantId: number;
};

@Injectable()
export class SignatureService {
  private logger = new Logger(SignatureService.name);
  private signatureDate = new SignatureDate();
  constructor(
    private readonly prisma: PrismaService,
    private readonly parametersService: ParametersService,
    private readonly catalogRounds?: CatalogRoundService
  ) { }

  private code() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
  }

  private async create<T>(operation: (tx: Prisma.TransactionClient, key: string) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 10; attempt++) {
      try { return await this.prisma.$transaction(tx => operation(tx, this.code()), { timeout: 15000 }); }
      catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002' || !String(error.meta?.target).includes('key')) throw error;
      }
    }
    throw new ServiceUnavailableException('Não foi possível gerar o link. Tente novamente.');
  }

  async generateTerritory({ overseer, expirationTime, territoryId, tenantId, round = null, canEditStructure = false }: GenerateTerritoryParams) {
    this.signatureDate.isValidDate(expirationTime);
    const expirationDate = this.signatureDate.generateExpirationDate(expirationTime);
    if (!Number.isFinite(expirationDate.getTime()) || expirationDate <= new Date()) throw new BadRequestException('Data de expiração inválida');
    return this.create(async (tx, key) => {
      const owned = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM territory WHERE id = ${territoryId} AND tenant_id = ${tenantId} FOR UPDATE`;
      if (!owned.length) throw new NotFoundException('Território não encontrado');
      const active = await tx.territory_overseer.findFirst({ where: { territoryId, tenantId, roundNumber: round == null ? null : +round, finished: false, signature: { expirationDate: { gt: new Date() } } } });
      if (active) throw new BadRequestException('Assinatura já gerada');
      const expired = await tx.territory_overseer.findMany({ where: { tenantId, territoryId, roundNumber: round == null ? null : +round, signature: { expirationDate: { lte: new Date() } } } });
      await tx.signature.deleteMany({ where: { tenantId, id: { in: expired.flatMap(row => row.signatureId ? [row.signatureId] : []) } } });
      const token = this.createJWT({ id: key, overseer, territoryId, tenantId, round: round == null ? null : +round, roles: [Role.DIRIGENTE] }, `${expirationTime} 23:59:59`);
      const signature = await tx.signature.create({ data: { key, expirationDate, token, tenantId, canEditStructure } });
      await tx.territory_overseer.create({ data: { territoryId, tenantId, overseer, roundNumber: round == null ? null : +round, initialDate: new Date(), expirationDate, signatureId: signature.id } });
      return { signature: key, expirationDate };
    });
  }

  async generateTerritoryBlock({ territoryId, blockId, tenantId, round = null, parentSignature }: GenerateBlockParams) {
    const customHours = Number(await this.parametersService.getValue(tenantId, 'SIGNATURE_EXPIRATION_HOURS'));
    const hours = Number.isFinite(customHours) && customHours > 0 ? customHours : 5;
    const expirationDate = new Date(Date.now() + hours * 3600000);
    return this.create(async (tx, key) => {
      const territory = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM territory WHERE id = ${territoryId} AND tenant_id = ${tenantId} FOR UPDATE`;
      if (!territory.length) throw new NotFoundException('Território não encontrado');
      if (parentSignature && !await tx.signature.findFirst({ where: { key: parentSignature, tenantId, expirationDate: { gt: new Date() } } })) throw new ForbiddenException('Link inválido ou expirado');
      const owned = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM territory_block
        WHERE territory_id = ${territoryId} AND block_id = ${blockId} AND tenant_id = ${tenantId} FOR UPDATE`;
      if (!owned.length) throw new NotFoundException('Bloco não encontrado');
      if (await tx.territory_block.findFirst({where:{territoryId,blockId,tenantId,registrationStatus:'rejected'}})) throw new ForbiddenException('Quadra rejeitada');
      const link = await tx.territory_block.findUniqueOrThrow({ where: { territoryId_blockId: { territoryId, blockId } }, include: { signature: true } });
      if (link.signature?.expirationDate && link.signature.expirationDate > new Date()) throw new BadRequestException('Assinatura já gerada');
      if (link.signature) await tx.signature.delete({ where: { id: link.signature.id } });
      const token = this.createJWT({ id: key, territoryId, blockId, tenantId, round: round == null ? null : +round, roles: [Role.PUBLICADOR] }, expirationDate.toISOString());
      const signature = await tx.signature.create({ data: { key, expirationDate, token, tenantId } });
      await tx.territory_block.update({ where: { id: link.id }, data: { signatureId: signature.id } });
      return { signature: key, expirationDate };
    });
  }

  async findTokenById(input: string) {
    const key = /^[a-z0-9]{6}$/i.test(input) ? input.toUpperCase() : input;
    if (!/^[A-Z0-9]{6}$/.test(key) && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(key)) throw new NotFoundException('Link inválido ou expirado');
    const signature = await this.prisma.signature.findUnique({ where: { key } });
    if (!signature?.expirationDate || signature.expirationDate <= new Date()) throw new NotFoundException('Link inválido ou expirado');
    let payload: TokenData & { exp: number };
    try { payload = jwt.verify(signature.token, envs.JWT_SECRET) as TokenData & { exp: number }; }
    catch { throw new NotFoundException('Link inválido ou expirado'); }
    if (payload.id !== key || payload.tenantId !== signature.tenantId) throw new NotFoundException('Link inválido ou expirado');
    const role = payload.roles.includes(Role.DIRIGENTE) ? 'overseer' : payload.roles.includes(Role.PUBLICADOR) ? 'publisher' : null;
    if (!role) throw new NotFoundException('Link inválido ou expirado');
    const roundInfo = this.catalogRounds ? await this.catalogRounds.resolve(payload.tenantId,payload.territoryId,payload.round) : payload.round == null ? null : await this.prisma.round_info.findUnique({where:{tenantId_roundNumber:{tenantId:payload.tenantId,roundNumber:+payload.round}}});
    if (payload.round != null && !roundInfo) throw new NotFoundException('Round não encontrado');
    return { token: signature.token, roundInfo, access: { code: key, role, territoryId: payload.territoryId, blockId: payload.blockId ?? null, round: payload.round == null ? null : +payload.round, canEditStructure: role === 'overseer' && signature.canEditStructure, expiresAt: signature.expirationDate, overseer: payload.overseer ?? '' } };
  }

  async deleteTerritorySignature(territoryId: number, tenantId: number, round?: number): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM territory WHERE id = ${territoryId} AND tenant_id = ${tenantId} FOR UPDATE`;
      const leaders = await tx.territory_overseer.findMany({ where: { tenantId, territoryId, ...(round ? { roundNumber: round } : {}), finished: false, signatureId: { not: null } } });
      if (!leaders.length) throw new NotFoundException('Assinatura não encontrada');
      const rounds = new Set(leaders.map(leader => leader.roundNumber));
      const blocks = await tx.territory_block.findMany({ where: { tenantId, territoryId, signatureId: { not: null } }, include: { signature: true } });
      const childIds = blocks.flatMap(block => {
        const payload = block.signature ? jwt.decode(block.signature.token) as TokenData | null : null;
        return !payload || rounds.has(payload.round == null ? null : +payload.round) ? [block.signatureId!] : [];
      });
      await tx.territory_overseer.updateMany({ where: { id: { in: leaders.map(leader => leader.id) } }, data: { signatureId: null, finished: true, expirationDate: new Date() } });
      await tx.signature.deleteMany({ where: { tenantId, id: { in: [...leaders.map(leader => leader.signatureId!), ...childIds] } } });
    });
  }

  async deleteBlockSignature(territoryId: number, blockId: number, tenantId: number, round?: number) {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM territory WHERE id = ${territoryId} AND tenant_id = ${tenantId} FOR UPDATE`;
      const block = await tx.territory_block.findFirst({ where: { tenantId, territoryId, blockId }, include: { signature: true } });
      if (!block?.signatureId) throw new NotFoundException('Quadra não encontrada');
      if (round && Number((jwt.decode(block.signature!.token) as TokenData)?.round) !== round) throw new NotFoundException('Assinatura não encontrada');
      await tx.signature.delete({ where: { id: block.signatureId } });
    });
  }

  async setPermissions(key: string, tenantId: number, canEditStructure: boolean) {
    const signature = await this.prisma.signature.findFirst({where:{key,tenantId,expirationDate:{gt:new Date()}}});
    if (!signature) throw new NotFoundException('Link não encontrado');
    const payload = jwt.verify(signature.token,envs.JWT_SECRET) as TokenData;
    if (!payload.roles.includes(Role.DIRIGENTE)) throw new BadRequestException('Somente links de dirigente permitem edição estrutural');
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM multi_tenancy WHERE id=${tenantId} FOR UPDATE`;
      await tx.signature.update({where:{id:signature.id},data:{canEditStructure}});
      return {canEditStructure};
    });
  }

  async catalogSignature(territoryId: number, tenantId: number) {
    if (!await this.prisma.territory.findFirst({where:{id:territoryId,tenantId}})) throw new NotFoundException('Território não encontrado');
    const row=await this.prisma.territory_overseer.findFirst({where:{territoryId,tenantId,roundNumber:null,finished:false,signature:{expirationDate:{gt:new Date()}}},include:{signature:true},orderBy:{id:'desc'}});
    return row?.signature ? {key:row.signature.key,overseer:row.overseer,expirationDate:row.signature.expirationDate,canEditStructure:row.signature.canEditStructure} : null;
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async deleteSignatureExpired() {
    this.logger.debug('Verificando assinaturas expiradas');
    const { count } = await this.prisma.signature.deleteMany({
      where: {
        expirationDate: {
          lte: this.signatureDate.now(),
        },
      },
    });
    if (count > 0) {
      this.logger.log(`Limpeza CRON: ${count} assinaturas expiradas removidas`);
    }
  }

  private createJWT(data: string | object | Buffer, expirationTime: string) {
    return jwt.sign(data, envs.JWT_SECRET, {
      expiresIn: calculateExpiresIn(expirationTime),
    });
  }

  async isTerritoryRound(territoryId: number, tenantId: number, round?: number | null) {
    const territory = await this.prisma.territory.findFirst({ where: { id: territoryId, tenantId } });
    const info = round == null ? true : await this.prisma.round_info.findUnique({ where: { tenantId_roundNumber: { tenantId, roundNumber: +round } } });
    if (!territory || !info) throw new NotFoundException('Round não encontrado');
  }
}
