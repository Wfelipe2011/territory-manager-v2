import {
    Controller,
    Get,
    Post,
    Query,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as Papa from 'papaparse';
import dayjs from 'dayjs';
import { TransactionsService } from './transactions.service';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { PrismaService } from './infra/prisma/prisma.service';
import { Public } from './decorators/public.decorator';

dayjs.extend(customParseFormat);


@Controller('transactions')
export class TransactionsController {
    constructor(private readonly transactionsService: TransactionsService, private readonly prisma: PrismaService) { }

    @Post('upload')
    @UseInterceptors(FileInterceptor('file'))
    async uploadCsv(@UploadedFile() file: Express.Multer.File) {
        if (!file) {
            return { message: 'No file uploaded' };
        }

        const csvData = file.buffer.toString('utf-8');

        const parsed = Papa.parse(csvData, {
            header: true,
            skipEmptyLines: true,
            delimiter: ',',
        });

        const transactions = parsed.data
            .map((row: any) => {
                // data vem DD/MM/YYYY vamos mudar para YYYY-MM-DD usando replace e regex
                if (!row['Data']) return null; // Ignora transações sem data
                row['Data'] = row['Data'].replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1');
                const parsedDate = dayjs(row['Data'].trim(), 'YYYY-MM-DD', true); // Valida a data

                if (!parsedDate.isValid()) {
                    console.warn(`❌ Data inválida encontrada: ${row['Data']}`);
                    return null; // Ignora transações com data inválida
                }

                return {
                    date: parsedDate.toDate(), // Agora garantimos que é um Date válido
                    time: row['Horário'].trim(),
                    timezone: row['Fuso horário'].trim(),
                    description: row['Descrição'].trim(),
                    currency: row['Moeda'].trim(),
                    grossAmount: parseFloat(row['Bruto '].replace(',', '.')),
                    feeAmount: parseFloat(row['Tarifa '].replace(',', '.')),
                    netAmount: parseFloat(row['Líquido'].replace(',', '.')),
                    balanceAfterTransaction: parseFloat(row['Saldo'].replace(',', '.')) || null,
                    transactionId: row['ID da transação'].trim(),
                    emailFrom: row['Do endereço de e-mail']?.trim() || null,
                    name: row['Nome']?.trim() || null,
                    bankName: row['Nome do banco']?.trim() || null,
                    bankAccount: row['Conta bancária']?.trim() || null,
                    shippingAmount: parseFloat(row['Valor do frete'].replace(',', '.')) || 0,
                    salesTax: parseFloat(row['Imposto sobre vendas'].replace(',', '.')) || 0,
                    invoiceId: row['ID da fatura']?.trim() || null,
                    referenceTransactionId: row['ID de referência da transação']?.trim() || null,
                };
            })
            .filter(Boolean); // Remove itens `null` do array

        return this.transactionsService.saveTransactions(transactions);
    }

    @Public()
    @Get('balance')
    async getBalance() {
        const currentYear = new Date().getFullYear();

        // Busca os lançamentos do ciclo atual
        const entries = await this.prisma.financial_entry.findMany({
            where: {
                cycle: currentYear,
            },
        });

        // Soma dos donativos (Entradas)
        const totalDonations = entries
            .filter((e) => e.type === 'POSITIVE')
            .reduce((sum, e) => sum + e.value, 0);

        // Mapeamento de custos para manter o contrato original
        const serverCost = entries
            .filter((e) => e.type === 'NEGATIVE' && e.description?.toLowerCase().includes('server'))
            .reduce((sum, e) => sum + e.value, 0);

        const registroBrCost = entries
            .filter((e) => e.type === 'NEGATIVE' && e.description?.toLowerCase().includes('registro'))
            .reduce((sum, e) => sum + e.value, 0);

        const backupCost = entries
            .filter((e) => e.type === 'NEGATIVE' && e.description?.toLowerCase().includes('backup'))
            .reduce((sum, e) => sum + e.value, 0);

        const totalCosts = entries
            .filter((e) => e.type === 'NEGATIVE')
            .reduce((sum, e) => sum + e.value, 0);

        return {
            balance: {
                totalDonations,
                fixedCosts: {
                    server: serverCost,
                    registroBr: registroBrCost,
                    backupDiario: backupCost,
                    total: totalCosts,
                },
                balance: totalDonations - totalCosts,
            },
            transactions: entries
                .filter((e) => e.type === 'POSITIVE')
                .map((t) => ({
                    date: t.date,
                    time: dayjs(t.date).format('HH:mm:ss'),
                    timezone: 'UTC',
                    currency: 'BRL',
                    total: t.value,
                    transactionId: `FIN-${t.id}`,
                    donor: t.donorName ? t.donorName.slice(0, 3).toUpperCase() : 'N/A',
                })),
        };
    }
}

