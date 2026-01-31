import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDonationDto {
    @ApiProperty({
        description: 'Nome do doador',
        example: 'João Silva',
    })
    @IsString()
    @IsNotEmpty()
    customer_name: string;

    @ApiProperty({
        description: 'Email do doador',
        example: 'doador@example.com',
    })
    @IsString()
    @IsNotEmpty()
    customer_email: string;

    @ApiProperty({
        description: 'Data do pagamento',
        example: '31/01/2026 08:15:54 GMT-03:00',
    })
    @IsString()
    @IsNotEmpty()
    payment_date: string;

    @ApiProperty({
        description: 'Valor do donativo em formato brasileiro',
        example: 'R$100,00',
    })
    @IsString()
    @IsNotEmpty()
    price: string;
}
