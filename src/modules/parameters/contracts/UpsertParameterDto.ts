import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpsertParameterDto {
    @ApiProperty({ description: 'Chave do parâmetro', example: 'SIGNATURE_EXPIRATION_HOURS' })
    @IsString()
    @IsNotEmpty()
    key: string;

    @ApiProperty({ description: 'Valor do parâmetro', example: '168' })
    @IsString()
    @IsNotEmpty()
    value: string;

    @ApiProperty({ description: 'Descrição opcional do parâmetro', example: 'Tempo de expiração da assinatura em horas', required: false })
    @IsString()
    @IsOptional()
    description?: string;
}
