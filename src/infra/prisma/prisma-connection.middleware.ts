import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaConnectionMiddleware implements NestMiddleware {
    private logger = new Logger(PrismaConnectionMiddleware.name);

    constructor(private readonly prisma: PrismaService) { }

    async use(req: Request, res: Response, next: NextFunction) {
        this.logger.log('Verificando conexão com o banco de dados...');
        if (!this.prisma.isConnected) {
            this.logger.warn('Banco desconectado. Tentando reconectar...');

            try {
                await this.prisma.connectToDatabase();
                this.logger.log('Conexão reestabelecida com sucesso.');
            } catch (error) {
                this.logger.error(`Falha ao reconectar: ${error.message}`);
            }
        }
        next();
    }
}
