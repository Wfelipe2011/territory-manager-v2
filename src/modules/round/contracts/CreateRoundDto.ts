import { ApiProperty } from "@nestjs/swagger";
import { ThemeMode } from "@prisma/client";
import { IsIn, IsNotEmpty, IsString, } from "class-validator";

export class CreateRoundDto {
  @ApiProperty({
    description: 'Nome da rodada',
    example: 'Residencial',
  })
  @IsString({ message: 'O nome da rodada deve ser uma string' })
  @IsNotEmpty({ message: 'O nome da rodada é obrigatório' })
  name: string;

  // typeId: number;
  @ApiProperty({
    description: 'Type ID da rodada',
    example: 1,
  })
  @IsNotEmpty({ message: 'O Type ID da rodada é obrigatório' })
  typeId: number;

  @ApiProperty({
    description: 'Tema da rodada',
    example: ThemeMode.default,
    enum: [ThemeMode.default, ThemeMode.campaign]
  })
  @IsIn([ThemeMode.default, ThemeMode.campaign], { message: 'O tema da rodada deve ser "normal" ou "campanha"' })
  @IsNotEmpty({ message: 'O tema da rodada é obrigatório' })
  theme: ThemeMode

  @ApiProperty({
    description: 'Cor primária da rodada',
    example: '#7AAD58',
  })
  @IsString({ message: 'A cor primária da rodada deve ser uma string' })
  @IsNotEmpty({ message: 'A cor primária da rodada é obrigatória' })
  colorPrimary: string;

  @ApiProperty({
    description: 'Cor secundária da rodada',
    example: '#7AAD58',
  })
  @IsString({ message: 'A cor secundária da rodada deve ser uma string' })
  @IsNotEmpty({ message: 'A cor secundária da rodada é obrigatória' })
  colorSecondary: string;
}
