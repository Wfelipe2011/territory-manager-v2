import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class BulkImportRow {
    @ApiProperty({ example: 'Residencial' })
    @IsString()
    @IsNotEmpty()
    TipoTerritorio: string;

    @ApiProperty({ example: 'Território 01' })
    @IsString()
    @IsNotEmpty()
    Território: string;

    @ApiProperty({ example: 1 })
    @IsNumber()
    @IsNotEmpty()
    Quadra: number;

    @ApiProperty({ example: 'Rua das Flores' })
    @IsString()
    @IsNotEmpty()
    Logradouro: string;

    @ApiProperty({ example: '123' })
    @IsString()
    @IsNotEmpty()
    Numero: string;

    @ApiProperty({ example: 'Comércio', required: false })
    @IsString()
    @IsOptional()
    Legenda?: string;

    @ApiProperty({ example: 1, required: false })
    @IsNumber()
    @IsOptional()
    Ordem?: number;

    @ApiProperty({ example: false, required: false })
    @IsBoolean()
    @IsOptional()
    'Não Bater'?: boolean;
}

export class BulkImportInput {
    @ApiProperty({ type: [BulkImportRow] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => BulkImportRow)
    rows: BulkImportRow[];
}

export interface ImportErrorReport {
    index: number;
    row: BulkImportRow;
    error: string;
}

export interface ImportReport {
    totalProcessed: number;
    successCount: number;
    errorCount: number;
    errors: ImportErrorReport[];
}
