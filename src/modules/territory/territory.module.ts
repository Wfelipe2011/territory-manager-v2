import { Module } from '@nestjs/common';
import { TerritoryService } from './territory.service';
import { TerritoryController } from './territory.controller';
import { PrismaService } from 'src/infra/prisma.service';
import { UploadTerritoryUseCase } from './upload-territory.usecase';
import { TerritoryControllerV2 } from './v2/territory.controller';
import { TerritoryServiceV2 } from './v2/territory.service';
import { FirebaseService } from 'src/infra/firebase.service';

@Module({
  controllers: [TerritoryController, TerritoryControllerV2],
  providers: [TerritoryService, PrismaService, UploadTerritoryUseCase, TerritoryServiceV2, FirebaseService],
})
export class TerritoryModule {}
