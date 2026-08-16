import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';

import { AppModule } from '../../src/app.module';
import { FirebaseService } from '../../src/infra/firebase.service';
import { PrismaService } from '../../src/infra/prisma/prisma.service';

export async function socketApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(FirebaseService)
    .useValue({
      onModuleInit: () => undefined,
      uploadFile: () => undefined,
      console: { log: () => undefined, error: () => undefined },
    })
    .compile();

  const app = moduleFixture.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.enableVersioning({ type: VersioningType.URI });
  await app.init();
  return app;
}

export const _internalPrisma = (app: INestApplication) => app.get(PrismaService);
