import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { UpsertParameterDto } from './contracts/UpsertParameterDto';

@Injectable()
export class ParametersService {
    private readonly logger = new Logger(ParametersService.name);

    constructor(private readonly prisma: PrismaService) { }

    async findAll(tenantId: number) {
        return this.prisma.parameter.findMany({
            where: { tenantId: +tenantId },
        });
    }

    async findByKey(tenantId: number, key: string) {
        return this.prisma.parameter.findUnique({
            where: {
                tenantId_key: {
                    tenantId,
                    key,
                },
            },
        });
    }

    async getValue(tenantId: number, key: string): Promise<string | null> {
        const parameter = await this.findByKey(tenantId, key);
        return parameter?.value || null;
    }

    async upsert(tenantId: number, data: UpsertParameterDto) {
        this.logger.log(`Upserting parameter ${data.key} for tenant ${tenantId}`);
        return this.prisma.parameter.upsert({
            where: {
                tenantId_key: {
                    tenantId,
                    key: data.key,
                },
            },
            update: {
                value: data.value,
                description: data.description,
            },
            create: {
                key: data.key,
                value: data.value,
                description: data.description,
                tenantId,
            },
        });
    }

    async delete(tenantId: number, key: string) {
        this.logger.log(`Deleting parameter ${key} for tenant ${tenantId}`);
        return this.prisma.parameter.delete({
            where: {
                tenantId_key: {
                    tenantId,
                    key,
                },
            },
        });
    }

    async createDefaultParameters(tenantId: number) {
        this.logger.log(`Creating default parameters for tenant ${tenantId}`);
        const defaults = [
            { key: 'SIGNATURE_EXPIRATION_HOURS', value: '5', description: 'Tempo de expiração da assinatura em horas' },
            { key: 'ROUND_START_DATE_MONTHS', value: '6', description: 'Meses para considerar o início de um novo round com cartas ativas' },
        ];

        await this.prisma.parameter.createMany({
            data: defaults.map(d => ({ ...d, tenantId })),
            skipDuplicates: true,
        });
    }
}
