import { Module } from '@nestjs/common';

import { ParametersModule } from '../parameters/parameters.module';
import { SignatureService } from '../signature/signature.service';
import { RoundController } from './round.controller';
import { RoundService } from './round.service';

@Module({
  imports: [ParametersModule],
  controllers: [RoundController],
  providers: [SignatureService, RoundService],
})
export class RoundModule {}
