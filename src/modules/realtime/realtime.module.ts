import { Module } from '@nestjs/common';

import { EventsBusModule } from '../events-bus/events-bus.module';
import { EventsBusWorker } from '../events-bus/events-bus.worker';
import { PresenceModule } from '../presence/presence.module';
import { WaitingRoomModule } from '../waiting-room/waiting-room.module';
import { RealtimeController } from './realtime.controller';
import { SseAuthService } from './sse-auth.service';
import { SseManager } from './sse.manager';

@Module({
  imports: [PresenceModule, EventsBusModule, WaitingRoomModule],
  controllers: [RealtimeController],
  providers: [SseManager, SseAuthService, EventsBusWorker],
  exports: [SseManager, SseAuthService],
})
export class RealtimeModule {}
