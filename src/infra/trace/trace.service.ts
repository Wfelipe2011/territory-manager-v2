import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import * as crypto from 'crypto';

export interface TraceContext {
    traceId: string;
    sessionId?: string;
    userId?: string;
    userName?: string;
    method?: string;
    url?: string;
    ip?: string;
    userAgent?: string;
    timestamp: number;
}

@Injectable()
export class TraceService {
    private readonly asyncLocalStorage = new AsyncLocalStorage<Map<string, any>>();

    // Instância singleton compartilhada globalmente
    private static globalInstance: TraceService | null = null;

    constructor() {
        // Garantir que usamos sempre a mesma instância global
        if (!TraceService.globalInstance) {
            TraceService.globalInstance = this;
        }
        // Retornar a instância global para que todos usem o mesmo AsyncLocalStorage
        return TraceService.globalInstance;
    }

    /**
     * Executa um callback dentro de um contexto isolado de trace
     */
    run<T>(callback: () => T): T {
        const store = new Map<string, any>();
        store.set('traceId', this.generateTraceId());
        store.set('timestamp', Date.now());
        return this.asyncLocalStorage.run(store, callback);
    }

    /**
     * Obtém o traceId do contexto atual
     */
    getTraceId(): string | undefined {
        return this.asyncLocalStorage.getStore()?.get('traceId');
    }

    /**
     * Obtém o contexto completo do trace atual
     */
    getContext(): TraceContext | undefined {
        const store = this.asyncLocalStorage.getStore();
        if (!store) return undefined;

        return {
            traceId: store.get('traceId'),
            sessionId: store.get('sessionId'),
            userId: store.get('userId'),
            userName: store.get('userName'),
            method: store.get('method'),
            url: store.get('url'),
            ip: store.get('ip'),
            userAgent: store.get('userAgent'),
            timestamp: store.get('timestamp'),
        };
    }

    /**
     * Define valores no contexto atual
     */
    setContext(key: string, value: any): void {
        const store = this.asyncLocalStorage.getStore();
        if (store) {
            store.set(key, value);
        }
    }

    /**
     * Define múltiplos valores no contexto
     */
    setContextBulk(context: Partial<TraceContext>): void {
        const store = this.asyncLocalStorage.getStore();
        if (store) {
            Object.entries(context).forEach(([key, value]) => {
                if (value !== undefined) {
                    store.set(key, value);
                }
            });
        }
    }

    /**
     * Gera um ID único para o trace
     * Formato: timestamp-random (ex: 1707649845123-a8f3x9k2p)
     */
    private generateTraceId(): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 11);
        return `${timestamp}-${random}`;
    }

    /**
     * Gera um sessionId baseado em User-Agent + IP
     * Usado como fallback quando cliente não envia X-Session-Id
     */
    generateSessionId(userAgent: string, ip: string): string {
        const hash = crypto
            .createHash('sha256')
            .update(`${userAgent}:${ip}`)
            .digest('hex')
            .substring(0, 16);
        return `sess-${hash}`;
    }
}
// Exportar instância global para uso no Winston format (antes do DI estar disponível)
export const globalTraceService = new TraceService();