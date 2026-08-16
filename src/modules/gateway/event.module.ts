import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { PaypalService } from './paypal.service';
import { UploadGateway } from './upload.gateway';

@Module({
  imports: [HttpModule],
  controllers: [],
  providers: [UploadGateway, PaypalService],
  exports: [UploadGateway, PaypalService],
})
export class EventsModule {}
