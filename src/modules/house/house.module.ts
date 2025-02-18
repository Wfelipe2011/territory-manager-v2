import { Module } from '@nestjs/common';
import { HouseController } from './house.controller';
import { HouseService } from './house.service';
import { EventsGateway } from '../gateway/event.gateway';

@Module({
  controllers: [HouseController],
  providers: [HouseService, EventsGateway],
})
export class HouseModule { }
