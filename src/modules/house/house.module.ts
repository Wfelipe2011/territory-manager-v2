import { Module } from '@nestjs/common';

import { AddressBlockService } from '../block/adress-block.service';
import { BlockModule } from '../block/block.module';
import { EventsModule } from '../gateway/event.module';
import { ParametersModule } from '../parameters/parameters.module';
import { HouseWorkerService } from './house-worker.service';
import { HouseController } from './house.controller';
import { HouseService } from './house.service';

@Module({
  imports: [EventsModule, ParametersModule],
  controllers: [HouseController],
  providers: [HouseService, HouseWorkerService, AddressBlockService],
})
export class HouseModule {}
