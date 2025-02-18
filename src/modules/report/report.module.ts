import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';

@Module({
  imports: [],
  controllers: [ReportController],
  providers: [],
})
export class ReportModule { }
