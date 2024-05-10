import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { IS_PUBLIC_KEY } from 'src/decorators/public.decorator';
import { envs } from 'src/infra/envs';
import { RequestUser } from 'src/interfaces/RequestUser';
import { UserToken } from '../contracts';

@Injectable()
export class AuthGuard implements CanActivate {
  logger = new Logger(AuthGuard.name);
  constructor(private reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const request = context.switchToHttp().getRequest<RequestUser>();
    if (isPublic) {
      this.logger.log(`Rota pública - ${request.url} - ${request.method}`);
      return true;
    }
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException('Não autorizado');
    }

    this.logger.log(`Rota privada - ${request.url} - ${request.method} - ${token}`);

    const payload = this.validateToken(token);
    request['user'] = payload;

    return true;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    let token = '';
    if (request?.headers?.authorization) {
      token = request?.headers?.authorization;
    } else if (request?.handshake?.auth.token) {
      token = request?.handshake?.auth.token;
    }
    if (!token) throw new UnauthorizedException('Token não encontrado');
    return token.replace('Bearer ', '');
  }

  validateToken(token: string) {
    try {
      const payload = jwt.verify(token, envs.JWT_SECRET);
      return payload as UserToken;
    } catch (error) {
      this.logger.error(`Token inválido: ${error.message} - Token: ${token}`);
      throw new UnauthorizedException(`Token inválido: ${error.message}`);
    }
  }
}
