import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
    UnauthorizedException,
    ForbiddenException,
} from '@nestjs/common';
import { Response, Request } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger(AllExceptionsFilter.name);

    catch(exception: any, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        const status = exception instanceof HttpException
            ? exception.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;

        const message = exception instanceof HttpException
            ? exception.message
            : 'Erro interno no servidor';

        // Log de erros graves (500)
        if (status >= 500) {
            this.logger.error(`[${request.method}] ${request.url} - Error: ${exception.stack || exception}`);
        }

        // Se for uma requisição GET que espera HTML
        const isHtml = request.headers.accept?.includes('text/html');
        if (request.method === 'GET' && isHtml) {
            // Caso especial: Dashboard redireciona para Login em erros de permissão ou não logado
            const isDashboard = request.url.includes('/dashboard');
            const isAuthError = status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN;

            if (isDashboard && isAuthError) {
                // Evitar loop se já estiver na página de login
                if (!request.url.includes('/dashboard/login')) {
                    return response.redirect('/v1/dashboard/login');
                }
            }

            // Renderizar views específicas conforme o erro
            if (status === HttpStatus.UNAUTHORIZED) {
                return response.status(status).render('401', { message });
            }
            if (status === HttpStatus.FORBIDDEN) {
                return response.status(status).render('403', { message });
            }

            // Fallback para qualquer outro erro (404, 500, etc)
            return response.status(status).render('error', {
                message: status === 404 ? 'Página não encontrada' : message,
                statusCode: status
            });
        }

        // Resposta padrão JSON para API/Mobile
        response.status(status).json({
            statusCode: status,
            timestamp: new Date().toISOString(),
            path: request.url,
            message,
        });
    }
}