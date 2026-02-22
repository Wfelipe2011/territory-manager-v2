import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { ConfigModule } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import WinstonCloudWatch from 'winston-cloudwatch';
import { envs } from './infra/envs';
import { AuthModule } from './modules/auth/auth.module';
import { TerritoryModule } from './modules/territory/territory.module';
import { AuthGuard } from './modules/auth/guard/auth.guard';
import { RolesGuard } from './modules/auth/guard/roles.guard';
import { ApiKeyGuard } from './decorators/api-key.guard';
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
import { ParametersModule } from './modules/parameters/parameters.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { PrismaConnectionMiddleware } from './infra/prisma/prisma-connection.middleware';
import { BlockModule } from './modules/block/block.module';
import { TraceModule } from './infra/trace/trace.module';
import { TraceMiddleware } from './infra/trace/trace.middleware';
import { globalTraceService } from './infra/trace/trace.service';
import { RecordsModule } from './modules/records/records.module';
import { FinancialModule } from './modules/financial/financial.module';
import { HttpModule } from '@nestjs/axios';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { FirebaseUploadService } from './firebase-upload.service';
import { FirebaseModule } from './infra/firebase.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { NameResolverModule } from './infra/name-resolver/name-resolver.module';

// Usar instância global singleton do TraceService
const winstonTransports: winston.transport[] = [
  new winston.transports.Console({
    level: envs.LOG_LEVEL,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.ms(),
      winston.format.colorize({ all: true }),
      winston.format.printf(
        ({ timestamp, level, message, context, ms, sessionId, method, url }) => {
          const session = sessionId ? `[${sessionId}]` : '';
          const reqInfo = method && url ? ` ${method} ${url}` : '';
          return `[${timestamp}] ${session} ${level} [${context || 'App'}] ${message}${reqInfo} ${ms}`;
        },
      ),
    ),
  }),
];

if (envs.AWS_ACCESS_KEY_ID && envs.AWS_SECRET_ACCESS_KEY) {
  winstonTransports.push(
    new WinstonCloudWatch({
      logGroupName: envs.CLOUDWATCH_LOG_GROUP,
      logStreamName: `instance-${process.env.HOSTNAME || process.env.INSTANCE_ID || 'local'}`,
      awsRegion: envs.AWS_REGION,
      jsonMessage: true,
      messageFormatter: (logObject) => {
        return JSON.stringify({
          ...logObject,
        });
      },
      awsOptions: {
        credentials: {
          accessKeyId: envs.AWS_ACCESS_KEY_ID,
          secretAccessKey: envs.AWS_SECRET_ACCESS_KEY,
        },
      },
    }),
  );
}

@Module({
  imports: [
    TraceModule,
    WinstonModule.forRoot({
      format: winston.format.combine(
        winston.format((info) => {
          const context = globalTraceService.getContext();
          if (context) {
            info.sessionId = context.sessionId;
            info.method = context.method;
            info.url = context.url;
          }
          return info;
        })(),
      ),
      transports: winstonTransports,
    }),
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
      max: 1000, // maximum number of items in cache
      isGlobal: true,
    }),
    ThrottlerModule.forRoot({
      ttl: 5, // seconds
      limit: 10000, //
    }),
    TenancyModule,
    ReportModule,
    BlockModule,
    RecordsModule,
    ParametersModule,
    FinancialModule,
    NameResolverModule,
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
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
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
    // TraceMiddleware deve vir ANTES para garantir contexto em todos os middlewares
    consumer.apply(TraceMiddleware).forRoutes('*');
    consumer.apply(PrismaConnectionMiddleware).forRoutes('*');
  }
}
