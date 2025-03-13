import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsInt, IsString, IsBoolean } from "class-validator";


export class UpsertHouseInput {
    @ApiProperty({ required: true, description: 'ID da rua', type: Number, example: 1 })
    @IsNotEmpty({ message: 'O ID da rua é obrigatório' })
    @IsInt({ message: 'O ID da rua deve ser um número' })
    streetId: number;

    @ApiProperty({ required: true, description: 'Número da casa', type: String, example: '123A' })
    @IsNotEmpty({ message: 'O número da casa é obrigatório' })
    @IsString({ message: 'O número da casa deve ser uma string' })
    number: string;

    @ApiProperty({ required: false, description: 'Legenda opcional para a casa', type: String, example: 'Casa azul' })
    @IsString({ message: 'A legenda deve ser uma string' })
    legend: string;

    @ApiProperty({ required: true, description: 'Indica se a casa não deve ser visitada', type: Boolean, example: true })
    @IsNotEmpty({ message: 'O campo dontVisit é obrigatório' })
    @IsBoolean({ message: 'O campo dontVisit deve ser um booleano' })
    dontVisit: boolean;

    @ApiProperty({ required: true, description: 'ID do território', type: Number, example: 5 })
    @IsNotEmpty({ message: 'O ID do território é obrigatório' })
    @IsInt({ message: 'O ID do território deve ser um número' })
    territoryId: number;

    @ApiProperty({ required: true, description: 'ID da quadra', type: Number, example: 2 })
    @IsNotEmpty({ message: 'O ID da quadra é obrigatório' })
    @IsInt({ message: 'O ID da quadra deve ser um número' })
    blockId: number;
}
