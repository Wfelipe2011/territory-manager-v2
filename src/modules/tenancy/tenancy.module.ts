import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ParametersModule } from '../parameters/parameters.module';
import { SignatureService } from '../signature/signature.service';
import { AdminTenancyController } from './admin-tenancy.controller';
import { TenancyController } from './tenancy.controller';

@Module({
  imports: [ParametersModule, AuthModule],
  controllers: [TenancyController, AdminTenancyController],
  providers: [SignatureService],
})
export class TenancyModule {}
