import { Module } from '@nestjs/common';

import { AddressBlockService } from './adress-block.service';
import { BlockController } from './block.controller';
import { BlockService } from './block.service';
import { TerritoryBlockService } from './territory-block.service';

@Module({
  imports: [],
  controllers: [BlockController],
  providers: [TerritoryBlockService, AddressBlockService, BlockService],
  exports: [BlockService],
})
export class BlockModule {}
