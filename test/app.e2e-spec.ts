import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/v1/health-check (GET)', () => {
    return request(app.getHttpServer())
      .get('/v1/health-check')
      .expect(200);
  });
});
