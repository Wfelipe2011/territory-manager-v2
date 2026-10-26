import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';

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
      .set('Authorization', `Bearer ${createTestToken({ roles: [Role.SUPER_ADMIN] })}`)
      .expect(200);
  });
});
