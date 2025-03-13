import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsInt, IsNotEmpty, ValidateNested } from "class-validator";

const example = [
    {
        "id": 41,
        "order": 1
    },
    {
        "id": 42,
        "order": 2
    },
    {
        "id": 1,
        "order": 3
    },
    {
        "id": 2,
        "order": 4
    },
    {
        "id": 3,
        "order": 5
    }
]


export class House {
    @ApiProperty({ required: true, description: 'Id da casa', type: Number, example: 1 })
    @IsNotEmpty({ message: 'Id é obrigatório' })
    @IsInt({ message: 'Id deve ser um número' })
    id: number;

    @ApiProperty({ required: true, description: 'Ordem da casa', type: Number, example: 2 })
    @IsNotEmpty({ message: 'Ordem é obrigatório' })
    @IsInt({ message: 'Ordem deve ser um número' })
    order: number;
}

export class UpdateHouseOrder {
    @ApiProperty({
        required: true,
        description: 'Lista de casas a serem ordenadas',
        type: House,
        isArray: true,
        example
    })
    @IsNotEmpty({ message: 'Casas são obrigatórias' })
    @IsArray({ message: 'Casas devem ser uma lista' })
    @ValidateNested({ each: true })
    @Type(() => House)
    houses: House[];
}

