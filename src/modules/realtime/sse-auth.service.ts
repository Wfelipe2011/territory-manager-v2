import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

import { envs } from '../../infra/envs';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface SseAuthContext {
  identityKey: string;
  tenantId: number;
  signatureExpiresAt: Date | null;
}

export interface TenantAuthContext {
  tenantId: number;
}

@Injectable()
export class SseAuthService {
  private readonly logger = new Logger(SseAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveBySignatureKey(signatureKey: string): Promise<SseAuthContext> {
    if (!signatureKey || typeof signatureKey !== 'string') {
      throw new UnauthorizedException('Assinatura ausente');
    }

    const signature = await this.prisma.signature.findUnique({
      where: { key: signatureKey },
      select: { id: true, token: true, tenantId: true, expirationDate: true },
    });

    if (!signature) {
      throw new UnauthorizedException('Assinatura inválida');
    }

    if (signature.expirationDate && signature.expirationDate.getTime() < Date.now()) {
      throw new UnauthorizedException('Assinatura expirada');
    }

    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(signature.token, envs.JWT_SECRET) as jwt.JwtPayload;
    } catch (err) {
      this.logger.warn(`Falha ao decodificar token da assinatura ${signature.id}: ${(err as Error).message}`);
      throw new UnauthorizedException('Assinatura inválida');
    }

    const identityKey = typeof decoded.id === 'string' ? decoded.id : String(decoded.id ?? '');
    if (!identityKey) {
      throw new UnauthorizedException('Identidade ausente no token');
    }

    const tenantId = typeof decoded.tenantId === 'number' ? decoded.tenantId : Number((decoded as { tenantId?: string | number }).tenantId);
    if (!Number.isFinite(tenantId) || tenantId !== signature.tenantId) {
      throw new UnauthorizedException('Assinatura não corresponde ao tenant');
    }

    return {
      identityKey,
      tenantId,
      signatureExpiresAt: signature.expirationDate,
    };
  }

  async resolveTenantBySignatureKey(signatureKey: string): Promise<TenantAuthContext> {
    if (!signatureKey || typeof signatureKey !== 'string') {
      throw new UnauthorizedException('Assinatura ausente');
    }

    const signature = await this.prisma.signature.findUnique({
      where: { key: signatureKey },
      select: { id: true, token: true, tenantId: true, kind: true, revokedAt: true },
    });

    if (!signature || signature.kind !== 'tenant') {
      throw new UnauthorizedException('Assinatura inválida');
    }

    if (signature.revokedAt) {
      throw new UnauthorizedException('Assinatura revogada');
    }

    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(signature.token, envs.JWT_SECRET) as jwt.JwtPayload;
    } catch (err) {
      this.logger.warn(`Falha ao decodificar token da assinatura de tenant ${signature.id}: ${(err as Error).message}`);
      throw new UnauthorizedException('Assinatura inválida');
    }

    const tenantId = typeof decoded.tenantId === 'number' ? decoded.tenantId : Number((decoded as { tenantId?: string | number }).tenantId);
    if (!Number.isFinite(tenantId) || tenantId !== signature.tenantId) {
      throw new UnauthorizedException('Assinatura não corresponde ao tenant');
    }

    return { tenantId };
  }
}
