import { Module } from '@nestjs/common';
import { EventsGateway } from './event.gateway';
import { UploadGateway } from './upload.gateway';
import { PaypalService } from './paypal.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  controllers: [],
  providers: [EventsGateway, UploadGateway, PaypalService],
  exports: [EventsGateway, UploadGateway, PaypalService],
})
export class EventsModule { }
