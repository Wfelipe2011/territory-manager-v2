import { Module } from '@nestjs/common';
import { TenancyController } from './tenancycontroller';
import { PrismaService } from 'src/infra/prisma.service';
import { SignatureService } from '../signature/signature.service';

@Module({
  controllers: [TenancyController],
  providers: [PrismaService, SignatureService],
})
export class TenancyModule {}
