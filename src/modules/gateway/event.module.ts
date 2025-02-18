import { Module } from '@nestjs/common';
import { EventsGateway } from './event.gateway';

@Module({
  imports: [],
  controllers: [],
  providers: [EventsGateway],
})
export class EventsModule { }
