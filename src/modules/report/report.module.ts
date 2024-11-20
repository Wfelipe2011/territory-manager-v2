import { Module } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma.service';
import { ReportController } from './report.controller';

@Module({
  imports: [],
  controllers: [ReportController],
  providers: [PrismaService],
})
export class ReportModule {}
