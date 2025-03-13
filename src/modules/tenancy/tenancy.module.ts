import { Module } from '@nestjs/common';
import { TenancyController } from './tenancy.controller';
import { SignatureService } from '../signature/signature.service';

@Module({
  controllers: [TenancyController],
  providers: [SignatureService],
})
export class TenancyModule { }
