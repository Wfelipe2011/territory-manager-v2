import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';

import { AppModule } from '../../src/app.module';
import { FirebaseService } from '../../src/infra/firebase.service';

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(FirebaseService)
    .useValue({
      onModuleInit: jest.fn(),
      uploadFile: jest.fn(),
      console: {
        log: jest.fn(),
        error: jest.fn(),
      },
    })
    .compile();

  const app = moduleFixture.createNestApplication({
    logger: false,
  });

  app.use(cookieParser());
  app.enableVersioning({
    type: VersioningType.URI,
  });

  await app.init();
  return app;
}
