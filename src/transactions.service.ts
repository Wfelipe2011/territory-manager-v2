import { Injectable } from '@nestjs/common';
import { PrismaService } from './infra/prisma/prisma.service';

@Injectable()
export class TransactionsService {
    constructor(private readonly prisma: PrismaService) { }

    async saveTransactions(transactions: any[]) {
        const createdTransactions = [];

        for (const transaction of transactions) {
            const existing = await this.prisma.paypal_transaction.findUnique({
                where: { transactionId: transaction.transactionId },
            });

            if (!existing) {
                const created = await this.prisma.paypal_transaction.create({
                    data: transaction,
                });
                createdTransactions.push(created);
            }
        }

        return { message: `${createdTransactions.length} transactions saved.` };
    }
}
