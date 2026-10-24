import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { fieldFixture } from './utils/field-fixture';

describe('Cursor novo após snapshot transacional', () => {
  let app: INestApplication;
  let ctx: Awaited<ReturnType<typeof fieldFixture>>;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await cleanDatabase(app.get(PrismaService)); ctx = await fieldFixture(app); });
  const read = (cursor?: string) => request(app.getHttpServer()).get(`/v1/field/blocks/${ctx.block.id}/sync`).set('Authorization', `Bearer ${ctx.publisherAccess.token}`).query({ ...ctx.identity, ...(cursor ? { cursor } : {}) });

  it('aguarda outra alteração em vez de repetir o snapshot com cursor atualizado', async () => {
    const initial = await read().expect(200);
    await ctx.prisma.house.update({ where: { id: ctx.house.id }, data: { complement: 'Atualizado' } });
    const fresh = await read().expect(200);
    expect(fresh.body.cursor).not.toBe(initial.body.cursor);
    let resolved = false;
    const pending = read(fresh.body.cursor).then(response => { resolved = true; return response; });
    await new Promise(resolve => setTimeout(resolve, 150));
    const premature = resolved;
    await ctx.prisma.house.update({ where: { id: ctx.house.id }, data: { complement: 'Outra atualização' } });
    const next = await pending;
    expect(premature).toBe(false);
    expect(next.status).toBe(200);
    expect(next.body.cursor).not.toBe(fresh.body.cursor);
  });
  it('não reutiliza escopo conflitante nem autorização entre requisições', async () => {
    await read().query({ blockId: ctx.block.id }).expect(200);
    const other = await fieldFixture(app);
    await read().query({ blockId: other.block.id }).expect(403);
    await request(app.getHttpServer()).patch(ctx.patchPath).set('Authorization', `Bearer ${ctx.publisherAccess.token}`).send({ status: true, round: 1, blockId: other.block.id }).expect(403);
    await ctx.signatures.deleteBlockSignature(ctx.territory.id, ctx.block.id, ctx.tenant.id, 1);
    await read().expect(403);
  });

});
