import { Global, Module } from '@nestjs/common';
import { ChangeRequestController } from './change-request.controller';
import { ChangeRequestService } from './change-request.service';
import { StreetOrderService } from './street-order.service';
@Global()
@Module({ controllers: [ChangeRequestController], providers: [ChangeRequestService, StreetOrderService], exports: [ChangeRequestService, StreetOrderService] })
export class ChangeRequestModule {}
