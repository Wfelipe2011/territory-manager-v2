import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_API_KEY_AUTH } from './api-key-auth.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const isApiKeyAuth = this.reflector.getAllAndOverride<boolean>(IS_API_KEY_AUTH, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!isApiKeyAuth) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const apiKey = request.headers['x-api-key'];

        if (!apiKey) {
            throw new UnauthorizedException('API Key não fornecida');
        }

        const validApiKey = process.env.API_KEY_SECRET;

        if (!validApiKey) {
            throw new UnauthorizedException('API Key não configurada no servidor');
        }

        if (apiKey !== validApiKey) {
            throw new UnauthorizedException('API Key inválida');
        }

        return true;
    }
}
