import { Body, Controller, Post, BadRequestException, HttpCode, HttpStatus, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { FinancialService } from './financial.service';
import { CreateDonationDto } from './dto/create-donation.dto';
import { Public } from 'src/decorators/public.decorator';
import { ApiKeyAuth } from 'src/decorators/api-key-auth.decorator';
import { VERSION } from 'src/enum/version.enum';
import { FinancialEntryType } from '@prisma/client';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

@ApiTags('Donations')
@ApiSecurity('apiKey')
@Controller({
    version: VERSION.V1,
    path: 'donations',
})
export class DonationController {
    constructor(private readonly financialService: FinancialService) { }

    @Post()
    @Public()
    @ApiKeyAuth()
    @HttpCode(HttpStatus.CREATED)
    @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
    @ApiOperation({ summary: 'Registrar donativo via API Key' })
    @ApiResponse({ status: 201, description: 'Donativo registrado com sucesso' })
    @ApiResponse({ status: 400, description: 'Dados inválidos' })
    @ApiResponse({ status: 401, description: 'API Key inválida' })
    async createDonation(@Body() createDonationDto: CreateDonationDto) {
        // Remover timezone da string para facilitar o parsing
        const dateString = createDonationDto.payment_date.replace(/\s*GMT[+-]\d{2}:\d{2}$/i, '').trim();

        // Parse da data com múltiplos formatos
        const dateFormats = [
            'DD/MM/YYYY HH:mm:ss',
            'DD/MM/YYYY',
            'YYYY-MM-DD HH:mm:ss',
            'YYYY-MM-DD',
        ];

        let parsedDate: dayjs.Dayjs | null = null;

        for (const format of dateFormats) {
            const attempt = dayjs(dateString, format, true);
            if (attempt.isValid()) {
                parsedDate = attempt;
                break;
            }
        }

        if (!parsedDate) {
            throw new BadRequestException(
                `Data inválida: ${createDonationDto.payment_date}. Formatos aceitos: DD/MM/YYYY HH:mm:ss, DD/MM/YYYY`
            );
        }

        // Parse do valor brasileiro (R$11,12 -> 11.12)
        const cleanedPrice = createDonationDto.price
            .replace(/R\$/g, '')
            .replace(/\./g, '')
            .replace(/,/g, '.')
            .trim();

        const parsedValue = parseFloat(cleanedPrice);

        if (isNaN(parsedValue) || parsedValue <= 0) {
            throw new BadRequestException(
                `Valor inválido: ${createDonationDto.price}. Use formato brasileiro (ex: R$11,12)`
            );
        }

        // Criar externalId único para evitar duplicatas
        const externalId = `paypal_${createDonationDto.customer_email}_${parsedDate.format('YYYYMMDDHHmmss')}`;

        return this.financialService.create({
            tenantId: 1,
            value: parsedValue,
            date: parsedDate.toDate(),
            description: createDonationDto.customer_email,
            type: FinancialEntryType.POSITIVE,
            donorName: createDonationDto.customer_name,
            externalId,
        });
    }
}
