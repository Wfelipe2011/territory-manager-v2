import { Module } from '@nestjs/common';
import { UploadGateway } from './upload.gateway';
import { PaypalService } from './paypal.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  controllers: [],
  providers: [UploadGateway, PaypalService],
  exports: [UploadGateway, PaypalService],
})
export class EventsModule { }
