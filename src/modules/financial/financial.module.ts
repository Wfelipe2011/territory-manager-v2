import { Module } from '@nestjs/common';
import { FinancialService } from './financial.service';
import { FinancialController } from './financial.controller';
import { DonationController } from './donation.controller';

@Module({
    controllers: [FinancialController, DonationController],
    providers: [FinancialService],
    exports: [FinancialService],
})
export class FinancialModule { }
