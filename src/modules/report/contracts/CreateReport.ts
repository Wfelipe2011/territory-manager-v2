import { IsNotEmpty, IsOptional, IsEnum, IsString, IsNumber } from 'class-validator';

enum ReportType {
  add = 'add',
  remove = 'remove',
  update = 'update',
}

export class CreateReportDto {
  @IsOptional()
  @IsNumber({}, { message: 'O campo "id" deve ser um número.' })
  id?: number;

  @IsNotEmpty({ message: 'O campo "territoryId" é obrigatório.' })
  @IsNumber({}, { message: 'O campo "territoryId" deve ser um número.' })
  territoryId!: number;

  @IsNotEmpty({ message: 'O campo "blockId" é obrigatório.' })
  @IsNumber({}, { message: 'O campo "blockId" deve ser um número.' })
  blockId!: number;

  @IsNotEmpty({ message: 'O campo "addressId" é obrigatório.' })
  @IsNumber({}, { message: 'O campo "addressId" deve ser um número.' })
  addressId!: number;

  @IsOptional()
  @IsNumber({}, { message: 'O campo "territoryBlockAddressId" deve ser um número.' })
  territoryBlockAddressId?: number;

  @IsNotEmpty({ message: 'O campo "observations" é obrigatório.' })
  @IsString({ message: 'O campo "observations" deve ser uma string.' })
  observations!: string;

  @IsNotEmpty({ message: 'O campo "legend" é obrigatório.' })
  @IsString({ message: 'O campo "legend" deve ser uma string.' })
  legend!: string;

  @IsNotEmpty({ message: 'O campo "number" é obrigatório.' })
  @IsString({ message: 'O campo "number" deve ser uma string.' })
  number!: string;

  @IsNotEmpty({ message: 'O campo "reportType" é obrigatório.' })
  @IsEnum(ReportType, { message: 'O campo "reportType" deve ser um tipo válido.' })
  reportType!: ReportType;

  @IsOptional()
  @IsString({ message: 'O campo "phone" deve ser uma string.' })
  phone?: string;

  @IsOptional()
  @IsNumber({}, { message: 'O campo "order" deve ser um número.' })
  order?: number;

  @IsOptional()
  @IsString({ message: 'O campo "complement" deve ser uma string.' })
  complement?: string;
}
