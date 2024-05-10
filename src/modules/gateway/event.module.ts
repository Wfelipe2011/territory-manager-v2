import { Module } from '@nestjs/common';
import { EventsGateway } from './event.gateway';
import { PrismaService } from 'src/infra/prisma.service';

@Module({
  imports: [],
  controllers: [],
  providers: [EventsGateway, PrismaService],
})
export class EventsModule {}
