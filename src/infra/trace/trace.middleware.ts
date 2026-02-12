import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TraceService } from './trace.service';
import { randomUUID } from 'crypto';

@Injectable()
export class TraceMiddleware implements NestMiddleware {
    constructor(private readonly traceService: TraceService) { }

    use(req: Request, res: Response, next: NextFunction) {
        // Captura ou gera sessionId via cookie para rastrear jornada do usuário
        let sessionId = req.cookies['tm_session'];

        if (!sessionId) {
            // Gera novo UUID para sessão
            sessionId = `sess-${randomUUID()}`;
        }

        // Define/renova cookie para manter sessão ativa (24h)
        res.cookie('tm_session', sessionId, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 1000 * 60 * 60 * 24, // 24 horas
        });

        // Cria um contexto isolado para esta requisição
        this.traceService.run(sessionId, () => {

            // Adiciona informações básicas da requisição
            this.traceService.setContextBulk({
                sessionId,
                method: req.method,
                url: req.url,
            });

            // Continua a execução da requisição dentro do contexto
            next();
        });
    }
}
