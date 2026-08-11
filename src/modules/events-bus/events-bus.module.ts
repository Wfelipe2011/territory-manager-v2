import { Global, Module } from '@nestjs/common';

import { EventsBusService } from './events-bus.service';

@Global()
@Module({
  providers: [EventsBusService],
  exports: [EventsBusService],
})
export class EventsBusModule {}
