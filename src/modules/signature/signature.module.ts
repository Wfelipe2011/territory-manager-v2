import { Module } from '@nestjs/common';

import { ParametersModule } from '../parameters/parameters.module';
import { SignatureController } from './signature.controller';
import { SignatureService } from './signature.service';
import { TenantSignatureController } from './tenant-signature.controller';

@Module({
  imports: [ParametersModule],
  controllers: [SignatureController, TenantSignatureController],
  providers: [SignatureService],
  exports: [SignatureService],
})
export class SignatureModule {}
