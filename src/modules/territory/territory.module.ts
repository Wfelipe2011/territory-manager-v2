import { Module } from '@nestjs/common';
import { TerritoryService } from './territory.service';
import { TerritoryController } from './territory.controller';
import { PrismaService } from 'src/infra/prisma.service';
import { UploadTerritoryUseCase } from './upload-territory.usecase';
import { UploadGateway } from '../gateway/upload.gateway';

@Module({
  controllers: [TerritoryController],
  providers: [TerritoryService, PrismaService, UploadTerritoryUseCase, UploadGateway],
})
export class TerritoryModule {}
