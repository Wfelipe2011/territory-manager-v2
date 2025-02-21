/* eslint-disable camelcase */

import { BlockSignature } from './BlockSignature';

export class BlockSignatureDTO {
  territoryId: number;
  blockId: number;
  territoryName: string;
  imageUrl?: string;
  blockName: string;
  addresses: {
    id: number;
    name: string;
    houses: string[];
  }[];

  static mapper(result: BlockSignature[]): BlockSignatureDTO {
    const { territory_id, territory_name, block_id, block_name, image_url } = result[0];
    const addresses = result
      .filter((item, index, self) => index === self.findIndex(t => t.address_id === item.address_id))
      .map(item => ({
        id: item.address_id,
        name: item.address_name,
        houses: result.reduce((acc, curr) => {
          if (curr.house_number === "ghost") return acc
          if (curr.address_id === item.address_id) {
            acc.push(curr.house_number);
          }
          return acc;
        }, [] as string[]),
      }));

    const dto = new BlockSignatureDTO();
    dto.territoryId = territory_id;
    dto.territoryName = territory_name;
    dto.imageUrl = image_url;
    dto.blockId = block_id;
    dto.blockName = block_name;
    dto.addresses = addresses;
    return dto;
  }
}
