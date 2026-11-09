import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateNested } from "class-validator";

export class StreetOrderEntryDto {
  @IsInt() @Min(1) id: number;
  @IsOptional() @IsInt() @Min(1) mappingId: number | null;
  @IsString() name: string;
  @IsString() status: string;
  @IsOptional() @IsInt() @Min(1) position: number | null;
}

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

  @IsOptional()
  @IsBoolean()
  saveStreetOrder?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StreetOrderEntryDto)
  expectedStreetOrder?: StreetOrderEntryDto[];

  @IsOptional()
  @IsString()
  expectedBlockName?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertAddressDto)
  expectedAddresses?: UpsertAddressDto[];
}

export class UpsertAddressDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  mappingId?: number;

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
