import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from "class-validator";

export class UpsertBlockDto {
  @ApiProperty({
    required: false,
    description: 'ID do bloco',
    type: Number,
    example: 1
  })
  @IsOptional()
  id?: number;

  @ApiProperty({
    required: true,
    description: 'Nome do bloco',
    type: String,
    example: 'Bloco A'
  })
  @IsNotEmpty({ message: 'O campo "nome" é obrigatório' })
  @IsString({ message: 'O campo "nome" deve ser um texto' })
  name: string;

  @ApiProperty({
    required: false,
    description: 'Lista de endereços associados ao bloco',
    example: [{ street: 'Rua X', zipCode: '12345-678' }]
  })
  @IsOptional()
  @IsArray({ message: 'O campo "endereço" deve ser uma lista' })
  @ValidateNested({ each: true })
  @Type(() => UpsertAddressDto)
  addresses: UpsertAddressDto[];
}

export class UpsertAddressDto {
  @ApiProperty({
    required: false,
    description: 'ID do endereço',
    type: Number,
    example: 101
  })
  @IsOptional()
  id?: number;

  @ApiProperty({
    required: true,
    description: 'Rua do endereço',
    type: String,
    example: 'Rua X'
  })
  @IsNotEmpty({ message: 'O campo "rua" é obrigatório' })
  @IsString({ message: 'O campo "rua" deve ser uma texto' })
  street: string;

  @ApiProperty({
    required: true,
    description: 'CEP do endereço',
    type: String,
    example: '12345-678'
  })
  @IsOptional()
  @IsString({ message: 'O campo "cep" deve ser um texto' })
  zipCode?: string;
}
