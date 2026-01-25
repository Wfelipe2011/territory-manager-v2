import { Module } from '@nestjs/common';
import { TenancyController } from './tenancy.controller';
import { AdminTenancyController } from './admin-tenancy.controller';
import { SignatureService } from '../signature/signature.service';
import { ParametersModule } from '../parameters/parameters.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ParametersModule, AuthModule],
  controllers: [TenancyController, AdminTenancyController],
  providers: [SignatureService],
})
export class TenancyModule { }
