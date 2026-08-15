import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class CreateAssignmentDto {
  @ApiProperty({ description: 'identityKey do publicador', example: '3f2b...', required: true })
  @IsNotEmpty({ message: 'O campo "publisherId" é obrigatório' })
  @IsString({ message: 'O campo "publisherId" deve ser um texto' })
  publisherId: string;

  @ApiProperty({ description: 'ID da quadra', example: 12, required: true })
  @Type(() => Number)
  @IsInt({ message: 'O campo "blockId" deve ser um número inteiro' })
  blockId: number;

  @ApiProperty({ description: 'ID do território', example: 3, required: true })
  @Type(() => Number)
  @IsInt({ message: 'O campo "territoryId" deve ser um número inteiro' })
  territoryId: number;

  @ApiProperty({ description: 'Número da rodada', example: 22, required: true })
  @Type(() => Number)
  @IsInt({ message: 'O campo "round" deve ser um número inteiro' })
  round: number;
}
