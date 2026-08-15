import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class JoinRoomDto {
  @ApiProperty({ description: 'Primeiro nome do publicador', example: 'João', required: false })
  @IsOptional()
  @IsString({ message: 'O campo "firstName" deve ser um texto' })
  firstName?: string;

  @ApiProperty({ description: 'Sobrenome do publicador', example: 'Silva', required: false })
  @IsOptional()
  @IsString({ message: 'O campo "lastName" deve ser um texto' })
  lastName?: string;

  @ApiProperty({ description: 'Últimos 4 dígitos do telefone', example: '1234', required: false })
  @IsOptional()
  @IsString({ message: 'O campo "phoneLast4" deve ser um texto' })
  phoneLast4?: string;

  @ApiProperty({ description: 'ID do território (dirigente)', example: 3, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'O campo "territoryId" deve ser um número inteiro' })
  territoryId?: number;

  @ApiProperty({ description: 'Número da rodada (dirigente)', example: 22, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'O campo "round" deve ser um número inteiro' })
  round?: number;
}
