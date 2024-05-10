import { Module } from '@nestjs/common';
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
import { PrismaService } from './infra/prisma.service';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AddressModule } from './modules/address/address.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';

@Module({
  imports: [
    AuthModule,
    TerritoryModule,
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
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'), // Caminho para a pasta pública
    }),
    TenancyModule,
  ],
  controllers: [AppController],
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
    PrismaService,
  ],
})
export class AppModule {}
