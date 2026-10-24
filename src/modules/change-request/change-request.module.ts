import { Global, Module } from '@nestjs/common';
import { ChangeRequestController } from './change-request.controller';
import { ChangeRequestService } from './change-request.service';
@Global()
@Module({ controllers: [ChangeRequestController], providers: [ChangeRequestService], exports: [ChangeRequestService] })
export class ChangeRequestModule {}
