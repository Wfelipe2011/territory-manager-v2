import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as jwt from 'jsonwebtoken';
import { Role } from 'src/enum/role.enum';
import { envs } from 'src/infra/envs';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { calculateExpiresIn, uuid } from 'src/shared';

import { ParametersService } from '../parameters/parameters.service';
import { SignatureDate } from './usecase/SignatureDate';

type GenerateTerritoryParams = {
  overseer: string;
  expirationTime: string;
  territoryId: number;
  tenantId: number;
  round: number;
};

type GenerateBlockParams = {
  territoryId: number;
  blockId: number;
  tenantId: number;
  round: number;
};

type TokenData = {
  id: string;
  overseer: string;
  territoryId: number;
  blockId: number;
  roles: Role[];
  round: string;
  tenantId: number;
};

@Injectable()
export class SignatureService {
  private logger = new Logger(SignatureService.name);
  private signatureDate = new SignatureDate();
  constructor(
    private readonly prisma: PrismaService,
    private readonly parametersService: ParametersService
  ) {}

  async generateTerritory({ overseer, expirationTime, territoryId, tenantId, round }: GenerateTerritoryParams): Promise<{ signature: string }> {
    this.signatureDate.isValidDate(expirationTime);

    const territoryOverseer = await this.prisma.territory_overseer.findFirst({
      where: {
        territoryId,
        roundNumber: +round,
        finished: false,
      },
      include: { signature: true },
    });

    if (territoryOverseer?.signatureId) throw new BadRequestException('Assinatura já gerada');

    const uniqueId = uuid();
    const token = this.createJWT({ id: uniqueId, overseer, territoryId, roles: [Role.DIRIGENTE], round, tenantId }, `${expirationTime} 23:59:59`);
    const signature = await this.createSignature(uniqueId, this.signatureDate.generateExpirationDate(expirationTime), token, tenantId);

    await this.prisma.territory_overseer.create({
      data: {
        territoryId: +territoryId,
        overseer,
        initialDate: this.signatureDate.now(),
        expirationDate: this.signatureDate.generateExpirationDate(expirationTime),
        signatureId: signature.id,
        tenantId,
        roundNumber: +round,
      },
    });
    return { signature: uniqueId };
  }

  async generateTerritoryBlock({ territoryId, blockId, tenantId, round }: GenerateBlockParams) {
    const territoryBlock = await this.prisma.territory_block.findUnique({
      where: {
        territoryId_blockId: {
          blockId,
          territoryId,
        },
      },
      include: { signature: true },
    });

    if (!territoryBlock) throw new NotFoundException('Bloco não encontrado');
    if (territoryBlock?.signature?.id) throw new BadRequestException('Assinatura já gerada');

    const uniqueId = uuid();
    const customHours = await this.parametersService.getValue(territoryBlock?.tenantId, 'SIGNATURE_EXPIRATION_HOURS');
    const hours = customHours ? parseInt(customHours) : 5;
    const expirationTime = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(); // 5 horas ou customizado
    const token = this.createJWT({ id: uniqueId, territoryId, blockId, roles: [Role.PUBLICADOR], tenantId, round }, expirationTime);
    const signature = await this.createSignature(uniqueId, new Date(expirationTime), token, tenantId);

    await this.prisma.territory_block.update({
      where: {
        territoryId_blockId: {
          territoryId: +territoryId,
          blockId: +blockId,
        },
      },
      data: {
        signature: {
          connect: {
            id: signature.id,
          },
        },
      },
    });
    return { signature: uniqueId };
  }

  async findTokenById(signatureId: string) {
    const signature = await this.prisma.signature.findUnique({
      where: { key: signatureId },
    });
    if (!signature) throw new NotFoundException('Assinatura não encontrada');
    const tokenDecode = jwt.decode(signature.token) as TokenData;
    this.logger.debug(`Token decodificado para assinatura ${signatureId}`, { tokenDecode });
    let roundInfo = null;
    if (tokenDecode.round) {
      roundInfo = await this.prisma.round_info.findFirst({
        where: {
          roundNumber: +tokenDecode.round,
          tenantId: tokenDecode.tenantId,
        },
      });
      if (!roundInfo) throw new NotFoundException('Round não encontrado');
    }
    return {
      token: signature.token,
      roundInfo,
    };
  }

  async deleteTerritorySignature(territoryId: number): Promise<void> {
    this.logger.log('Deletando assinatura do território');

    const territoryOverseer = await this.prisma.territory_overseer.findFirst({
      where: {
        territoryId,
        finished: false,
        signature: {
          isNot: null,
        },
      },
      include: { signature: true },
    });

    if (!territoryOverseer?.signatureId) throw new NotFoundException('Assinatura não encontrada');

    await this.prisma.territory_overseer.update({
      where: {
        id: territoryOverseer.id,
      },
      data: {
        expirationDate: this.signatureDate.now(),
        finished: true,
        signatureId: null,
      },
    });

    await this.prisma.signature.delete({
      where: {
        id: territoryOverseer.signatureId,
      },
    });

    const territoryBlocks = await this.prisma.territory_block.findMany({
      where: {
        territoryId,
        signature: {
          isNot: null,
        },
      },
      include: { signature: true },
    });

    if (!territoryBlocks.length) return;

    this.logger.log('Deletando assinatura das quadras');
    await Promise.all(
      territoryBlocks
        .flatMap(territoryBlock => (territoryBlock.signatureId ? [territoryBlock.signatureId] : []))
        .map(signatureId =>
          this.prisma.signature.delete({
            where: {
              id: signatureId,
            },
          })
        )
    );
  }

  async deleteBlockSignature(territoryId: number, blockId: number) {
    const territoryBlock = await this.prisma.territory_block.findFirst({
      where: {
        territoryId,
        blockId,
      },
    });
    if (!territoryBlock?.signatureId) throw new NotFoundException('Quadra não encontrada');

    await this.prisma.signature.delete({
      where: {
        id: territoryBlock.signatureId,
      },
    });
  }

  async generateTenantSignature(tenantId: number): Promise<{ key: string }> {
    await this.prisma.signature.updateMany({
      where: {
        tenantId,
        kind: 'tenant',
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    const uniqueId = uuid();
    const token = jwt.sign({ id: uniqueId, tenantId, kind: 'tenant', roles: [Role.PUBLICADOR] }, envs.JWT_SECRET);
    const signature = await this.prisma.signature.create({
      data: {
        key: uniqueId,
        expirationDate: null,
        token,
        tenantId,
        kind: 'tenant',
      },
    });
    this.logger.log(`Assinatura de tenant gerada para o tenant ${tenantId}`);
    return { key: signature.key };
  }

  async getTenantSignature(tenantId: number) {
    const signature = await this.prisma.signature.findFirst({
      where: {
        tenantId,
        kind: 'tenant',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        key: true,
        createdAt: true,
        revokedAt: true,
      },
    });
    if (!signature) throw new NotFoundException('Assinatura de tenant não encontrada');
    return signature;
  }

  async revokeTenantSignature(tenantId: number): Promise<{ revoked: boolean }> {
    const { count } = await this.prisma.signature.updateMany({
      where: {
        tenantId,
        kind: 'tenant',
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
    this.logger.log(`Revogadas ${count} assinaturas de tenant do tenant ${tenantId}`);
    return { revoked: true };
  }

  async generateBlockSignatureForShare({ territoryId, blockId, tenantId, round }: GenerateBlockParams): Promise<{ key: string }> {
    const territoryBlock = await this.prisma.territory_block.findFirst({
      where: {
        territoryId,
        blockId,
        tenantId,
      },
    });
    if (!territoryBlock) throw new NotFoundException('Bloco não encontrado');

    const uniqueId = uuid();
    const customHours = await this.parametersService.getValue(territoryBlock.tenantId, 'SIGNATURE_EXPIRATION_HOURS');
    const hours = customHours ? parseInt(customHours) : 5;
    const expirationTime = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(); // 5 horas ou customizado
    const token = this.createJWT({ id: uniqueId, territoryId, blockId, roles: [Role.PUBLICADOR], tenantId, round }, expirationTime);
    const signature = await this.prisma.signature.create({
      data: {
        key: uniqueId,
        expirationDate: new Date(expirationTime),
        token,
        tenantId,
        kind: 'block',
      },
    });

    await this.prisma.territory_block.update({
      where: {
        territoryId_blockId: {
          territoryId: +territoryId,
          blockId: +blockId,
        },
      },
      data: {
        signatureId: signature.id,
      },
    });
    this.logger.log(`Assinatura de quadra gerada para compartilhamento (block ${blockId})`);
    return { key: signature.key };
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

  private async createSignature(uniqueId: string, expirationDate: Date, token: string, tenantId: number) {
    return await this.prisma.signature.create({
      data: {
        key: uniqueId,
        expirationDate,
        token,
        tenantId,
      },
    });
  }

  private createJWT(data: string | object | Buffer, expirationTime: string) {
    return jwt.sign(data, envs.JWT_SECRET, {
      expiresIn: calculateExpiresIn(expirationTime),
    });
  }

  async isTerritoryRound(territoryId: number) {
    const isRoundStarted = await this.prisma.$queryRaw`SELECT * FROM round WHERE round.territory_id = ${territoryId} AND end_date IS NULL`;
    if (!isRoundStarted) throw new NotFoundException('Round não encontrado');
  }
}
