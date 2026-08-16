import { Module } from '@nestjs/common';

import { AddressBlockService } from '../block/adress-block.service';
import { EventsModule } from '../gateway/event.module';
import { TerritoryController } from './territory.controller';
import { TerritoryService } from './territory.service';
import { UploadTerritoryUseCase } from './upload-territory.usecase';
import { TerritoryControllerV2 } from './v2/territory.controller';
import { TerritoryServiceV2 } from './v2/territory.service';

@Module({
  imports: [EventsModule],
  controllers: [TerritoryController, TerritoryControllerV2],
  providers: [TerritoryService, UploadTerritoryUseCase, TerritoryServiceV2, AddressBlockService],
})
export class TerritoryModule {}
