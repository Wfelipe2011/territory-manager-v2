import { ApiProperty } from '@nestjs/swagger';

class Address {
  @ApiProperty({ required: true, description: 'Id da rua', type: Number, example: 1 })
  id: number;
  @ApiProperty({ required: true, description: 'Nome da rua', type: String, example: 'Rua 1' })
  name: string;
  @ApiProperty({ required: true, description: 'Lista de casas', type: String, example: ['Casa 1', 'Casa 2'] })
  houses: string[];
}

export class AddressPerTerritoryAndBlockOutput {
  @ApiProperty({ required: true, description: 'Id do território', type: Number, example: 1 })
  territoryId: number;
  @ApiProperty({ required: true, description: 'Nome do território', type: String, example: 'Vila Velha' })
  territoryName: string;
  @ApiProperty({ required: true, description: 'Id da quadra', type: Number, example: 1 })
  blockId: number;
  @ApiProperty({ required: true, description: 'Nome da quadra', type: String, example: 'Quadra 1' })
  blockName: string;

  @ApiProperty({ required: true, description: 'Objeto de endereços', type: Address, isArray: true })
  addresses: Address[];
}
