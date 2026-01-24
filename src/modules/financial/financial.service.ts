import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FinancialEntryType } from '@prisma/client';

@Injectable()
export class FinancialService {
    constructor(private prisma: PrismaService) { }

    async create(data: {
        tenantId: number;
        value: number;
        date: Date;
        description?: string;
        type: FinancialEntryType;
        donorName?: string;
        externalId?: string;
    }) {
        const cycle = new Date(data.date).getFullYear();
        return this.prisma.financial_entry.create({
            data: {
                ...data,
                cycle,
            },
        });
    }

    async findAll(tenantId: number) {
        return this.prisma.financial_entry.findMany({
            where: { tenantId },
            orderBy: { date: 'desc' },
            include: { multitenancy: true }
        });
    }

    async findOne(id: number) {
        return this.prisma.financial_entry.findUnique({
            where: { id },
        });
    }

    async update(id: number, data: {
        value?: number;
        date?: Date;
        description?: string;
        type?: FinancialEntryType;
        donorName?: string;
    }) {
        const updateData: any = { ...data };
        if (data.date) {
            updateData.cycle = new Date(data.date).getFullYear();
        }
        return this.prisma.financial_entry.update({
            where: { id },
            data: updateData,
        });
    }

    async remove(id: number) {
        return this.prisma.financial_entry.delete({
            where: { id },
        });
    }

    async getSummary(tenantId?: number) {
        const where = tenantId ? { tenantId } : {};

        const entries = await this.prisma.financial_entry.findMany({
            where,
        });

        const totalEntries = entries
            .filter(e => e.type === FinancialEntryType.POSITIVE)
            .reduce((sum, e) => sum + e.value, 0);

        const totalExits = entries
            .filter(e => e.type === FinancialEntryType.NEGATIVE)
            .reduce((sum, e) => sum + e.value, 0);

        return {
            totalEntries,
            totalExits,
            balance: totalEntries - totalExits,
        };
    }

    async getTenants() {
        return this.prisma.multitenancy.findMany({
            select: {
                id: true,
                name: true,
            },
            orderBy: {
                name: 'asc',
            },
        });
    }
}
