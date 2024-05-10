import { Module } from '@nestjs/common';
import { RoundController } from './round.controller';
import { PrismaService } from 'src/infra/prisma.service';
import { SignatureService } from '../signature/signature.service';
import { RoundService } from './round.service';

@Module({
  controllers: [RoundController],
  providers: [PrismaService, SignatureService, RoundService],
})
export class RoundModule {}
