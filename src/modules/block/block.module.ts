import { Module } from '@nestjs/common';
import { BlockController } from './block.controller';
import { TerritoryBlockService } from './territory-block.service';
import { AddressBlockService } from './adress-block.service';
import { BlockService } from './block.service';

@Module({
  imports: [],
  controllers: [BlockController],
  providers: [TerritoryBlockService, AddressBlockService, BlockService],
})
export class BlockModule { }
