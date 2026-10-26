import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { ConcurrencyService } from '../src/modules/dashboard/concurrency.service';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { fieldFixture } from './utils/field-fixture';
import { Role } from '../src/enum/role.enum';

describe('Painel de operação superadmin', () => {
  let app: INestApplication;
  let ctx: Awaited<ReturnType<typeof fieldFixture>>;
  const superToken = () => createTestToken({ roles:[Role.SUPER_ADMIN] });
  beforeAll(async () => { app=await createTestApp(); await app.get(ConcurrencyService).onModuleDestroy(); });
  beforeEach(async () => { await cleanDatabase(app.get(PrismaService)); ctx=await fieldFixture(app); });
  afterAll(async () => { await app.close(); });

  it('protege analytics e saúde detalhada contra acesso anônimo e admin comum', async () => {
    for (const path of ['/v1/dashboard/usage','/v1/sessions','/v1/health-check']) {
      await request(app.getHttpServer()).get(path).expect(401);
      await request(app.getHttpServer()).get(path).set('Authorization',`Bearer ${ctx.adminToken}`).expect(403);
      await request(app.getHttpServer()).get(path).set('Authorization',`Bearer ${superToken()}`).expect(200);
    }
  });

  it('distingue usuários cadastrados, presença de campo e atividade operacional sem financeiro', async () => {
    await request(app.getHttpServer()).get('/v1/field/sync').query(ctx.query).set('Authorization',`Bearer ${ctx.publisherAccess.token}`).expect(200);
    await app.get(ConcurrencyService).collect();
    const res=await request(app.getHttpServer()).get('/v1/dashboard/usage?period=1d').set('Authorization',`Bearer ${superToken()}`).expect(200);
    expect(res.body.summary).toMatchObject({ congregations:1,activeCongregations:1,online:1,peak:1,houses:1,territories:1,registeredUsers:0,openRounds:1,pendingRequests:0 });
    expect(res.body.tenants[0]).toMatchObject({ id:ctx.tenant.id,fieldActivity:true,city:'Sorocaba',state:'SP' });
    expect(res.body.cities[0]).toMatchObject({ city:'Sorocaba',congregations:1,online:1 });
    expect(JSON.stringify(res.body)).not.toMatch(/financial|globalBalance/);
  });

  it('filtra congregação sem trocar sessão e não infere atividade a partir de usuários cadastrados', async () => {
    const other=await ctx.prisma.multitenancy.create({data:{name:'Sem atividade',city:'Outra cidade',state:'RJ'}});
    const res=await request(app.getHttpServer()).get(`/v1/dashboard/usage?tenantId=${other.id}`).set('Authorization',`Bearer ${superToken()}`).expect(200);
    expect(res.body.scope).toBe(other.id);
    expect(res.body.summary).toMatchObject({congregations:1,activeCongregations:0,online:0,peak:null,average:null});
    expect(res.body.tenants).toHaveLength(1);
    // Trace middleware may set tm_session, but inspecting must not replace auth.
    expect((res.headers['set-cookie'] || []).join(';')).not.toContain('access_token=');
    expect(res.body.options).toHaveLength(2);
  });

  it('valida filtros e períodos personalizados antes de consultar', async () => {
    for(const query of ['tenantId=abc','tenantId=-1','tenantId=99999999','period=invalido','groupBy=__proto__','from=2026-01-01','from=2026-02-01&to=2026-01-01']) {
      await request(app.getHttpServer()).get('/v1/dashboard/usage?'+query).set('Authorization',`Bearer ${superToken()}`).expect(400);
    }
  });
});
