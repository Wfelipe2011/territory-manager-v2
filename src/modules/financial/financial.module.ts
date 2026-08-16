import { Module } from '@nestjs/common';

import { DonationController } from './donation.controller';
import { FinancialController } from './financial.controller';
import { FinancialService } from './financial.service';

@Module({
  controllers: [FinancialController, DonationController],
  providers: [FinancialService],
  exports: [FinancialService],
})
export class FinancialModule {}
