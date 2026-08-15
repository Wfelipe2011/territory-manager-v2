import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class DeleteAssignmentDto {
  @ApiProperty({ description: 'identityKey do publicador', example: '3f2b...', required: true })
  @IsNotEmpty({ message: 'O campo "publisherId" é obrigatório' })
  @IsString({ message: 'O campo "publisherId" deve ser um texto' })
  publisherId: string;

  @ApiProperty({ description: 'ID da quadra', example: 12, required: true })
  @Type(() => Number)
  @IsInt({ message: 'O campo "blockId" deve ser um número inteiro' })
  blockId: number;
}
