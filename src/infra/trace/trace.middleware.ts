import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TraceService } from './trace.service';
import * as jwt from 'jsonwebtoken';
import { envs } from '../envs';

@Injectable()
export class TraceMiddleware implements NestMiddleware {
    constructor(private readonly traceService: TraceService) { }

    use(req: Request, res: Response, next: NextFunction) {
        // Cria um contexto isolado para esta requisição
        this.traceService.run(() => {
            const traceId = this.traceService.getTraceId() || 'no-trace';

            // Adiciona traceId no header da resposta
            res.setHeader('X-Trace-Id', traceId);

            // Captura ou gera sessionId para correlacionar múltiplas requisições do mesmo cliente
            const clientSessionId = req.headers['x-session-id'] as string;
            const userAgent = req.headers['user-agent'] || 'unknown';
            const ip = req.ip || req.socket.remoteAddress || 'unknown';

            const sessionId = clientSessionId || this.traceService.generateSessionId(userAgent, ip);
            res.setHeader('X-Session-Id', sessionId);

            // Adiciona informações básicas da requisição
            this.traceService.setContextBulk({
                sessionId,
                method: req.method,
                url: req.url,
                ip,
                userAgent,
            });

            // Tenta extrair userId e userName do JWT (mesma lógica do @Loggable)
            try {
                const authHeader = req.headers.authorization;
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    const token = authHeader.split(' ')[1];
                    const decoded = jwt.verify(token, envs.JWT_SECRET) as any;

                    if (decoded.userId) {
                        this.traceService.setContext('userId', decoded.userId.toString());
                    }
                    if (decoded.userName) {
                        this.traceService.setContext('userName', decoded.userName);
                    }
                }
            } catch (error) {
                // Token inválido ou ausente - contexto continua sem userId
            }

            // Continua a execução da requisição dentro do contexto
            next();
        });
    }
}
