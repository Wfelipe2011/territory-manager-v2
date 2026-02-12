import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface TraceContext {
    sessionId: string;
    method?: string;
    url?: string;
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
    run<T>(sessionId: string, callback: () => T): T {
        const store = new Map<string, any>();
        store.set('sessionId', sessionId);
        store.set('timestamp', Date.now());
        return this.asyncLocalStorage.run(store, callback);
    }

    /**
     * Obtém o sessionId do contexto atual
     */
    getSessionId(): string | undefined {
        return this.asyncLocalStorage.getStore()?.get('sessionId');
    }

    /**
     * Obtém o contexto completo do trace atual
     */
    getContext(): TraceContext | undefined {
        const store = this.asyncLocalStorage.getStore();
        if (!store) return undefined;

        return {
            sessionId: store.get('sessionId'),
            method: store.get('method'),
            url: store.get('url'),
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

}
// Exportar instância global para uso no Winston format (antes do DI estar disponível)
export const globalTraceService = new TraceService();