import { Module } from '@nestjs/common';
import { RoundController } from './round.controller';
import { SignatureService } from '../signature/signature.service';
import { RoundService } from './round.service';

@Module({
  controllers: [RoundController],
  providers: [SignatureService, RoundService],
})
export class RoundModule { }
