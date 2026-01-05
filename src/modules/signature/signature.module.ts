import { Module } from '@nestjs/common';
import { SignatureController } from './signature.controller';
import { SignatureService } from './signature.service';
import { ParametersModule } from '../parameters/parameters.module';

@Module({
  imports: [ParametersModule],
  controllers: [SignatureController],
  providers: [SignatureService],
})
export class SignatureModule { }
