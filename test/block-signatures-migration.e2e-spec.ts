import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { fieldFixture } from './utils/field-fixture';
import { createTestToken } from './utils/auth-helper';
const { Client } = require('../field-worker/node_modules/pg');
const { check } = require('../scripts/check-legacy-block-signatures.cjs');

describe('Migração aditiva dos links legados de quadra', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  it('bloqueia vínculo ativo inconsistente e importa UUID válido sem mudar token, prazo ou histórico', async () => {
    const prisma = app.get(PrismaService);
    await cleanDatabase(prisma);
    const ctx = await fieldFixture(app);
    const key = randomUUID(), expirationDate = new Date(Date.now() + 365 * 86400000);
    const token = createTestToken({ id: key, tenantId: ctx.tenant.id, territoryId: ctx.territory.id, blockId: ctx.block.id, round: '1', roles: ['publisher'] });
    const signature = await prisma.signature.create({ data: { key, token, expirationDate, tenantId: ctx.tenant.id } });
    // Simulate the pre-migration schema, retaining the original business data.
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const migration = readFileSync('prisma/migrations/20261027130000_block_signatures_per_round/migration.sql', 'utf8');
    try {
      await client.query(`DROP TABLE block_signature CASCADE;
        DROP FUNCTION legacy_block_signature_round(text,text,integer,integer,integer) CASCADE;
        DROP FUNCTION validate_block_signature() CASCADE;
        DROP FUNCTION import_legacy_block_signature() CASCADE;
        DROP FUNCTION field_block_signature_changed() CASCADE;`);
      await prisma.territory_block.update({ where: { territoryId_blockId: { territoryId: ctx.territory.id, blockId: ctx.block.id } }, data: { signatureId: signature.id } });
      const invalid = await prisma.signature.create({ data: { key: randomUUID(), token: 'invalid', tenantId: ctx.tenant.id, expirationDate } });
      const block = await prisma.block.create({ data: { name: 'Quadra legada inconsistente', tenantId: ctx.tenant.id } });
      const badLink = await prisma.territory_block.create({ data: { tenantId: ctx.tenant.id, territoryId: ctx.territory.id, blockId: block.id, signatureId: invalid.id } });
      expect(await check(prisma)).toMatchObject({ ready: false, issues: [{ territoryBlockId: badLink.id, reason: 'invalid_live_scope' }] });
      await expect(client.query(migration)).rejects.toThrow('Inspect live legacy block signature associations');
      await client.query('ROLLBACK');
      expect((await client.query("SELECT to_regclass('public.block_signature') AS relation")).rows[0].relation).toBeNull();
      await prisma.signature.update({ where: { id: invalid.id }, data: { expirationDate: new Date(0) } });
      expect((await check(prisma)).ready).toBe(true);
      await client.query(migration);
      const imported = await prisma.block_signature.findMany({ include: { signature: true } });
      expect(imported).toHaveLength(1);
      expect(imported[0]).toMatchObject({ tenantId: ctx.tenant.id, roundNumber: 1, signatureId: signature.id, signature: { key, token, expirationDate } });
      expect(await prisma.round.count({ where: { houseId: ctx.house.id } })).toBe(1);
      expect(await prisma.signature.findUnique({ where: { id: invalid.id } })).not.toBeNull();
      expect((await ctx.signatures.findTokenById(key)).access.round).toBe(1);
    } finally { await client.query('ROLLBACK'); await client.end(); }
  });
});
