import { Module } from '@nestjs/common';
import { TerritoryService } from './territory.service';
import { TerritoryController } from './territory.controller';
import { PrismaService } from 'src/infra/prisma.service';

@Module({
  controllers: [TerritoryController],
  providers: [TerritoryService, PrismaService],
})
export class TerritoryModule {}
