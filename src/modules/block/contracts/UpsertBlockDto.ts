import { Type } from "class-transformer";
import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, ValidateNested } from "class-validator";

export class UpsertBlockDto {
  @IsOptional()
  id?: number;

  @IsNotEmpty({ message: 'O campo "nome" é obrigatório' })
  @IsString({ message: 'O campo "nome" deve ser um texto' })
  name: string;

  @IsOptional()
  @IsArray({ message: 'O campo "endereço" deve ser uma lista' })
  @ValidateNested({ each: true })
  @Type(() => UpsertAddressDto)
  addresses: UpsertAddressDto[];
}

export class UpsertAddressDto {
  @IsOptional()
  id?: number;

  @IsNotEmpty({ message: 'O campo "rua" é obrigatório' })
  @IsString({ message: 'O campo "rua" deve ser uma texto' })
  street: string;

  @IsNotEmpty({ message: 'O campo "cep" é obrigatório' })
  @IsString({ message: 'O campo "cep" deve ser um texto' })
  zipCode: string;
}