import { Module } from '@nestjs/common';
import { HouseController } from './house.controller';
import { HouseService } from './house.service';
import { PrismaService } from 'src/infra/prisma.service';
import { EventsGateway } from '../gateway/event.gateway';

@Module({
  controllers: [HouseController],
  providers: [HouseService, PrismaService, EventsGateway],
})
export class HouseModule {}
