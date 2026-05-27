import { Module } from '@nestjs/common';
import { TerritoryService } from './territory.service';
import { TerritoryController } from './territory.controller';
import { UploadTerritoryUseCase } from './upload-territory.usecase';
import { TerritoryControllerV2 } from './v2/territory.controller';
import { TerritoryServiceV2 } from './v2/territory.service';
import { EventsModule } from '../gateway/event.module';
import { AddressBlockService } from '../block/adress-block.service';

@Module({
  imports: [EventsModule],
  controllers: [TerritoryController, TerritoryControllerV2],
  providers: [TerritoryService, UploadTerritoryUseCase, TerritoryServiceV2, AddressBlockService],
})
export class TerritoryModule { }
