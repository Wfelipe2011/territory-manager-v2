import { Module } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma.service';
import { SignatureController } from './signature.controller';
import { SignatureService } from './signature.service';

@Module({
  controllers: [SignatureController],
  providers: [SignatureService, PrismaService],
})
export class SignatureModule {}
