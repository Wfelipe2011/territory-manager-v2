import { Module } from '@nestjs/common';
import { HouseController } from './house.controller';
import { HouseService } from './house.service';
import { EventsGateway } from '../gateway/event.gateway';
import { HouseWorkerService } from './house-worker.service';
import { BlockModule } from '../block/block.module';
import { AddressBlockService } from '../block/adress-block.service';

@Module({
  imports: [],
  controllers: [HouseController],
  providers: [HouseService, EventsGateway, HouseWorkerService, AddressBlockService],
})
export class HouseModule { }
