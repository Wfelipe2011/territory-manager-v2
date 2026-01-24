import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    UnauthorizedException,
    Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

@Catch(UnauthorizedException)
export class DashboardAuthFilter implements ExceptionFilter {
    private readonly logger = new Logger(DashboardAuthFilter.name);

    catch(exception: UnauthorizedException, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        // Se a requisição for para o dashboard e for uma rota de "View" (GET que espera HTML)
        if (request.url.includes('/dashboard') && request.method === 'GET' && !request.headers.accept?.includes('application/json')) {
            this.logger.debug(`Redirecionando usuário não autenticado de ${request.url} para o login`);
            return response.redirect('/v1/dashboard/login');
        }

        // Caso contrário, mantém o comportamento padrão (JSON de erro)
        const status = exception.getStatus();
        response.status(status).json(exception.getResponse());
    }
}
