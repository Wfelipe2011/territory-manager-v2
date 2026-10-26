import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { fieldFixture } from './utils/field-fixture';
import { PrismaService } from '../src/infra/prisma/prisma.service';

describe('Gestão superadmin integrada', () => {
  let app: INestApplication, ctx: Awaited<ReturnType<typeof fieldFixture>>;
  let actor: { id: number }, token: string;
  const originalId = process.env.SUPER_ADMIN_ID;
  beforeAll(async () => { app = await createTestApp(); });
  beforeEach(async () => {
    await cleanDatabase(app.get(PrismaService)); ctx = await fieldFixture(app);
    actor = await ctx.prisma.user.create({ data: { name: 'QA Superadmin', email: 'superadmin@qa.test', password: 'unused', tenantId: ctx.tenant.id } });
    process.env.SUPER_ADMIN_ID = String(actor.id);
    token = createTestToken({ userId: actor.id, roles: ['admin', 'super_admin'], tenantId: ctx.tenant.id });
  });
  afterAll(async () => { if (originalId === undefined) delete process.env.SUPER_ADMIN_ID; else process.env.SUPER_ADMIN_ID = originalId; await app.close(); });

  it('consulta e edição são exclusivas do superadmin e não trocam o usuário', async () => {
    const path = `/v1/admin/tenants/${ctx.tenant.id}`;
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${ctx.adminToken}`).expect(403);
    await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).patch(path).set('Authorization', `Bearer ${token}`).send({ name: 'QA Editada', city: 'Campinas', state: 'sp', phone: '' }).expect(200);
    expect(await ctx.prisma.multitenancy.findUnique({ where: { id: ctx.tenant.id } })).toMatchObject({ name: 'QA Editada', state: 'SP', phone: null });
    expect((await ctx.prisma.user.findUnique({ where: { id: actor.id } }))!.tenantId).toBe(ctx.tenant.id);
  });
  it('acessar atualiza o vínculo persistente do usuário e devolve outro JWT para o Admin', async () => {
    const other = await ctx.prisma.multitenancy.create({ data: { name: 'QA Destino' } });
    const response = await request(app.getHttpServer()).post('/v1/admin/tenants/switch').set('Authorization', `Bearer ${token}`).set('Accept', 'application/json').send({ tenantId: other.id }).expect(200);
    expect(jwt.decode(response.body.token)).toMatchObject({ userId: actor.id, tenantId: other.id, tenantName: 'QA Destino', roles: ['admin', 'super_admin'] });
    expect((await ctx.prisma.user.findUnique({ where: { id: actor.id } }))!.tenantId).toBe(other.id);
    expect(response.headers.location).toBeUndefined();
  });
  it('mantém o redirecionamento e cookie do formulário legado', async () => {
    const response = await request(app.getHttpServer()).post('/v1/admin/tenants/switch').set('Authorization', `Bearer ${token}`).type('form').send({ tenantId: ctx.tenant.id }).expect(302);
    expect(response.headers.location).toBe('/v1/dashboard');
    expect(response.headers['set-cookie'].join(';')).toContain('access_token=');
  });
  it('recusa cadastro inválido e congregação inexistente sem mudar o usuário', async () => {
    await request(app.getHttpServer()).patch(`/v1/admin/tenants/${ctx.tenant.id}`).set('Authorization', `Bearer ${token}`).send({ name: '', city: 'QA', state: 'SP' }).expect(400);
    await request(app.getHttpServer()).post('/v1/admin/tenants/switch').set('Authorization', `Bearer ${token}`).set('Accept', 'application/json').send({ tenantId: -1 }).expect(400);
    await request(app.getHttpServer()).get('/v1/admin/tenants/99999999').set('Authorization', `Bearer ${token}`).expect(404);
    expect((await ctx.prisma.user.findUnique({ where: { id: actor.id } }))!.tenantId).toBe(ctx.tenant.id);
  });
});
