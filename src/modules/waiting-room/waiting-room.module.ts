import { Module } from '@nestjs/common';

import { BlockModule } from '../block/block.module';
import { SignatureModule } from '../signature/signature.module';
import { WaitingRoomCleanupCron } from './waiting-room-cleanup.cron';
import { WaitingRoomController } from './waiting-room.controller';
import { WaitingRoomService } from './waiting-room.service';

@Module({
  imports: [BlockModule, SignatureModule],
  controllers: [WaitingRoomController],
  providers: [WaitingRoomService, WaitingRoomCleanupCron],
  exports: [WaitingRoomService],
})
export class WaitingRoomModule {}
