import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateGroupDto {
  @ApiProperty({ description: 'Novo nome do grupo', example: 'Grupo 2', required: true })
  @IsNotEmpty({ message: 'O campo "name" é obrigatório' })
  @IsString({ message: 'O campo "name" deve ser um texto' })
  name: string;
}
