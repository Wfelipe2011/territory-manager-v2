import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

@Injectable()
export class NameResolverService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(NameResolverService.name);

    private tenants = new Map<number, string>();
    private territories = new Map<number, string>();
    private blocks = new Map<number, string>();
    private addresses = new Map<number, string>();

    private refreshTimer: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly prisma: PrismaService) { }

    async onModuleInit(): Promise<void> {
        await this.load();
        this.refreshTimer = setInterval(() => {
            this.load().catch((err) =>
                this.logger.error('Erro ao atualizar NameResolver em background', err),
            );
        }, REFRESH_INTERVAL_MS);
    }

    onModuleDestroy(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    private async load(): Promise<void> {
        try {
            const [tenants, territories, blocks, addresses] = await Promise.all([
                this.prisma.multitenancy.findMany({ select: { id: true, name: true } }),
                this.prisma.territory.findMany({ select: { id: true, name: true } }),
                this.prisma.block.findMany({ select: { id: true, name: true } }),
                this.prisma.address.findMany({ select: { id: true, name: true } }),
            ]);

            this.tenants = new Map(tenants.map((t) => [t.id, t.name]));
            this.territories = new Map(territories.map((t) => [t.id, t.name]));
            this.blocks = new Map(blocks.map((b) => [b.id, b.name]));
            this.addresses = new Map(addresses.map((a) => [a.id, a.name]));

            this.logger.log(
                `NameResolver carregado: ${this.tenants.size} tenants, ${this.territories.size} territórios, ${this.blocks.size} blocos, ${this.addresses.size} endereços`,
            );
        } catch (err) {
            this.logger.error('Falha ao carregar NameResolver', err);
        }
    }

    resolveTenant(id: number): string {
        return this.tenants.get(id) ?? String(id);
    }

    resolveTerritory(id: number): string {
        return this.territories.get(Number(id)) ?? String(id);
    }

    resolveBlock(id: number): string {
        return this.blocks.get(Number(id)) ?? String(id);
    }

    resolveAddress(id: number): string {
        return this.addresses.get(Number(id)) ?? String(id);
    }
}
