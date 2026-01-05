import { Module } from '@nestjs/common';
import { HouseController } from './house.controller';
import { HouseService } from './house.service';
import { HouseWorkerService } from './house-worker.service';
import { BlockModule } from '../block/block.module';
import { AddressBlockService } from '../block/adress-block.service';
import { EventsModule } from '../gateway/event.module';
import { ParametersModule } from '../parameters/parameters.module';

@Module({
  imports: [EventsModule, ParametersModule],
  controllers: [HouseController],
  providers: [HouseService, HouseWorkerService, AddressBlockService],
})
export class HouseModule { }
