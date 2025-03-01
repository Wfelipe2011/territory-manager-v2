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
    async getBalance(
        @Query('startDate') startDate: string,
        @Query('endDate') endDate: string,
    ) {
        // Converte as datas para o formato correto
        const start = dayjs(startDate, 'YYYY-MM-DD').startOf('day').toDate();
        const end = dayjs(endDate, 'YYYY-MM-DD').endOf('day').toDate();

        // Busca as transações dentro do intervalo
        const transactions = await this.prisma.paypal_transaction.findMany({
            where: {
                description: 'Pagamento de doação',
                date: {
                    gte: start,
                    lte: end,
                },
            },
        });
        // custos: KVM 2 (683.88) + Registro BR 40,00 ano + backup diario (306.73)
        // Custos fixos associados
        // const fixedCosts = 683.88 + 40 + 306.73; vamos declarar
        const fixedCosts = {
            server: 683.88,
            registroBr: 40,
            backupDiario: 306.73,
        }
        // Soma dos custos fixos
        const costs = Object.values(fixedCosts).reduce((sum, cost) => sum + cost, 0);

        // Soma dos valores das transações
        const totalDonations = transactions.reduce((sum, transaction) => sum + transaction.netAmount, 0);


        return {
            balance: {
                totalDonations,
                fixedCosts: {
                    ...fixedCosts,
                    total: costs,
                },
                balance: totalDonations - costs,
            },
            transactions: transactions.map((t) => ({
                date: t.date,
                time: t.time,
                timezone: t.timezone,
                currency: t.currency,
                total: t.netAmount,
                transactionId: t.transactionId, // Mantemos o ID da transação
                donor: t.name ? t.name.slice(0, 3).toUpperCase() : 'N/A', // Exibe as 3 primeiras letras em maiúsculas
            })),
        };
    }
}

