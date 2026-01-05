import { Module } from '@nestjs/common';
import { TenancyController } from './tenancy.controller';
import { SignatureService } from '../signature/signature.service';
import { ParametersModule } from '../parameters/parameters.module';

@Module({
  imports: [ParametersModule],
  controllers: [TenancyController],
  providers: [SignatureService],
})
export class TenancyModule { }
