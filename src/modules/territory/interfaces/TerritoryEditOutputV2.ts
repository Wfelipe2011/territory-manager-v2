import { ApiProperty } from "@nestjs/swagger";

class HouseOutput {
    @ApiProperty({
        description: 'ID da casa',
        type: Number,
        example: 1
    })
    id: number;

    @ApiProperty({
        description: 'Ordem da casa',
        type: Number,
        example: 2,
        nullable: true
    })
    order: number | null;

    @ApiProperty({
        description: 'Número da casa',
        type: String,
        example: '123A'
    })
    number: string;

    @ApiProperty({
        description: 'Legenda da casa',
        type: String,
        example: 'Casa com cachorro',
        nullable: true
    })
    legend: string | null;

    @ApiProperty({
        description: 'Se a casa não deve ser visitada',
        type: Boolean,
        example: false
    })
    dontVisit: boolean;

    @ApiProperty({
        description: 'Observações sobre a casa',
        type: String,
        example: 'Casa com portão azul',
        nullable: true
    })
    observations: string | null;

    @ApiProperty({
        description: 'Rua da casa',
        type: String,
        example: 'Rua das Flores'
    })
    street: string;

    @ApiProperty({
        description: 'ID da rua',
        type: Number,
        example: 10
    })
    streetId: number;

    @ApiProperty({
        description: 'Nome do bloco',
        type: String,
        example: 'Bloco A'
    })
    blockName: string;

    @ApiProperty({
        description: 'ID do bloco',
        type: Number,
        example: 5
    })
    blockId: number;
}

export class TerritoryEditOutput {
    @ApiProperty({
        description: 'Nome do território',
        type: String,
        example: 'Território 1'
    })
    name: string;

    @ApiProperty({
        description: 'Nome do tipo de território',
        type: String,
        example: 'Residencial'
    })
    typeName: string;

    @ApiProperty({
        description: 'URL da imagem do território',
        type: String,
        example: 'http://example.com/image.jpg',
        nullable: true
    })
    imageUrl: string | null;

    @ApiProperty({
        description: 'Total de casas no território',
        type: Number,
        example: 1
    })
    totalHouse: number;

    @ApiProperty({
        description: 'Lista de casas no território',
        type: [HouseOutput]
    })
    house: HouseOutput[];
}