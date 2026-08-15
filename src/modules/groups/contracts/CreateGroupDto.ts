import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ description: 'Nome do grupo', example: 'Grupo 1', required: true })
  @IsNotEmpty({ message: 'O campo "name" é obrigatório' })
  @IsString({ message: 'O campo "name" deve ser um texto' })
  name: string;
}
