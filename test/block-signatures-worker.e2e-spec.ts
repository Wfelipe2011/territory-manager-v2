import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { FieldService } from '../src/modules/field/field.service';
import { FieldAccessService } from '../src/modules/field/field-access.service';
import { CatalogRoundService } from '../src/modules/round/catalog-round.service';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { fieldFixture } from './utils/field-fixture';
// Use the authoritative source rules in a fresh checkout, without a prior build.
jest.mock('../dist/modules/house/house-permissions.js', () => require('../src/modules/house/house-permissions'), { virtual: true });
jest.mock('../dist/modules/field/pair-suggestion.js', () => require('../src/modules/field/pair-suggestion'), { virtual: true });
const createAdapter = require('../field-worker/pg-adapter.cjs');
const aggregate = require('../field-worker/aggregate-snapshot.cjs');
const readModels = require('../field-worker/read-model.cjs');
const normalize = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('Equivalência API/worker dos links por rodada', () => {
  let app: INestApplication, db: any, worker: any, model: any;
  let ctx: Awaited<ReturnType<typeof fieldFixture>>;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await cleanDatabase(app.get(PrismaService)); ctx = await fieldFixture(app);
    db = createAdapter(process.env.DATABASE_URL, Prisma.dmmf.datamodel.models);
    await db.$connect(); await db.$readModelReady();
    const rounds = new CatalogRoundService(db);
    worker = new FieldService(db, new FieldAccessService(db, rounds), rounds);
    const original = worker.snapshot.bind(worker);
    worker.snapshot = async (tx: any, user: any, scope: any, info: any) => {
      if (scope.fullBlock) {
        const value = await tx.$blockSnapshot(user, scope, info);
        return value === undefined ? original(tx.$baselineAdapter(), user, scope, info) : value;
      }
      return original(tx, user, scope, info);
    };
    model = readModels.install(db, aggregate.snapshot, aggregate.SQL);
    db.$setBlockSnapshot(model.read); model.attach(worker);
    require('../field-worker/snapshot-group.cjs').install(worker, db);
  });
  afterEach(async () => { model?.close(); await db?.$disconnect(); });
  const poll = (field: any, token: string, fullBlock: boolean) => field.poll(jwt.decode(token), {
    ...ctx.identity, scope: fullBlock ? 'block' : 'territory', ...(fullBlock ? { blockId: String(ctx.block.id) } : {}),
  }, new AbortController().signal, fullBlock);

  it('seleciona os links corretos em duas rodadas e no cadastro, inclusive com read model compartilhado', async () => {
    await ctx.prisma.round_info.create({ data: { tenantId: ctx.tenant.id, roundNumber: 2, type: ctx.type.name, name: 'QA 2', theme: 'default' } });
    await ctx.prisma.round.create({ data: { tenantId: ctx.tenant.id, territoryId: ctx.territory.id, blockId: ctx.block.id, houseId: ctx.house.id, roundNumber: 2, completed: false } });
    const tokens = [ctx.leaderAccess.token];
    for (const round of [2, null]) {
      const leader = await ctx.signatures.generateTerritory({ tenantId: ctx.tenant.id, territoryId: ctx.territory.id, round, overseer: 'QA', expirationTime: '2099-12-31' });
      const access = await ctx.signatures.findTokenById(leader.signature); tokens.push(access.token);
      await ctx.signatures.generateTerritoryBlock({ tenantId: ctx.tenant.id, territoryId: ctx.territory.id, blockId: ctx.block.id, round });
    }
    tokens.push(ctx.publisherAccess.token);
    const expected = [];
    for (const token of tokens) {
      const publisher = (jwt.decode(token) as any).roles.includes('publisher');
      for (const fullBlock of publisher ? [true] : [false, true]) {
        const reference = await poll(app.get(FieldService), token, fullBlock);
        const response = await poll(worker, token, fullBlock);
        expect(normalize(response.data)).toEqual(normalize(reference.data));
        if (fullBlock) {
          const again = await poll(worker, token, fullBlock);
          expect(normalize(again.data)).toEqual(normalize(reference.data));
          if (!publisher) expected.push(response.data.block.signature.key);
          else expect(response.data.block.signature).toBeNull();
        }
      }
    }
    expect(new Set(expected).size).toBe(3);
    expect(model.stats().hits).toBeGreaterThan(0);
    const stored = await ctx.prisma.$queryRaw<{ safe: boolean }[]>`SELECT bool_and(payload->'block'->'_signature'='null'::jsonb) safe FROM field_read_model`;
    expect(stored[0].safe).toBe(true);
  });

  it('recalcula expiração e revogação sem servir assinatura antiga do catálogo persistido', async () => {
    const before = await poll(worker, ctx.leaderAccess.token, true);
    expect(before.data.block.signature.key).toBe(ctx.publisher.signature);
    await ctx.prisma.signature.update({ where: { key: ctx.publisher.signature }, data: { expirationDate: new Date(0) } });
    expect((await poll(worker, ctx.leaderAccess.token, true)).data.block.signature).toBeNull();
    const replacement = await ctx.signatures.generateTerritoryBlock({ tenantId: ctx.tenant.id, territoryId: ctx.territory.id, blockId: ctx.block.id, round: 1 });
    expect((await poll(worker, ctx.leaderAccess.token, true)).data.block.signature.key).toBe(replacement.signature);
    await ctx.signatures.deleteBlockSignature(ctx.territory.id, ctx.block.id, ctx.tenant.id, 1);
    expect((await poll(worker, ctx.leaderAccess.token, true)).data.block.signature).toBeNull();
    const publisher = jwt.decode(ctx.publisherAccess.token);
    await expect(worker.poll(publisher, { ...ctx.identity, scope: 'block', blockId: String(ctx.block.id) }, new AbortController().signal, true)).rejects.toMatchObject({ status: 403 });
  });
});
