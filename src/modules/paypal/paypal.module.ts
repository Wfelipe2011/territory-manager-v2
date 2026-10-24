import { Module } from '@nestjs/common';
import { PaypalService } from './paypal.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  controllers: [],
  providers: [PaypalService],
  exports: [PaypalService],
})
export class PaypalModule { }
