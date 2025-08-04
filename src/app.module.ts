import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { TerritoryModule } from './modules/territory/territory.module';
import { AuthGuard } from './modules/auth/guard/auth.guard';
import { RolesGuard } from './modules/auth/guard/roles.guard';
import { SignatureModule } from './modules/signature/signature.module';
import { ScheduleModule } from '@nestjs/schedule';
import { RoundModule } from './modules/round/round.module';
import { CacheInterceptor, CacheModule } from '@nestjs/cache-manager';
import { HouseModule } from './modules/house/house.module';
import { EventsModule } from './modules/gateway/event.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AddressModule } from './modules/address/address.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportModule } from './modules/report/report.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { PrismaConnectionMiddleware } from './infra/prisma/prisma-connection.middleware';
import { BlockModule } from './modules/block/block.module';
import { RecordsModule } from './modules/records/records.module';
import { HttpModule } from '@nestjs/axios';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { FirebaseUploadService } from './firebase-upload.service';
import { FirebaseModule } from './infra/firebase.module';

@Module({
  imports: [
    HttpModule,
    PrismaModule,
    FirebaseModule,
    AuthModule,
    TerritoryModule,
    DashboardModule,
    HouseModule,
    RoundModule,
    SignatureModule,
    EventsModule,
    AddressModule,
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    CacheModule.register({
      ttl: 60, // seconds
      max: 100, // maximum number of items in cache
      isGlobal: true,
    }),
    ThrottlerModule.forRoot({
      ttl: 5, // seconds
      limit: 10000, //
    }),
    TenancyModule,
    ReportModule,
    BlockModule,
    RecordsModule
  ],
  controllers: [AppController, TransactionsController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    TransactionsService,
    FirebaseUploadService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(PrismaConnectionMiddleware).forRoutes('*');
  }
}
