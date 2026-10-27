import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { AgentCatalogService } from '../src/modules/agents/catalog.service';
import { AgentPrincipal, digest } from '../src/modules/agents/agent.config';

describe('Vínculos e concorrência do catálogo de agentes', () => {
  let app: INestApplication, prisma: PrismaService, catalog: AgentCatalogService;
  let a: any, b: any;
  const prior = { ...process.env };
  beforeAll(async () => { app = await createTestApp(); prisma = app.get(PrismaService); catalog = app.get(AgentCatalogService); });
  afterAll(async () => { await app.close(); for (const key of Object.keys(process.env)) if (key.startsWith('AGENT_')) delete process.env[key]; Object.assign(process.env, prior); });
  beforeEach(async () => {
    await cleanDatabase(prisma);
    async function seed(name: string) {
      const tenant = await prisma.multitenancy.create({ data: { name } });
      const user = await prisma.user.create({ data: { name, email: `${name}@local.test`, tenantId: tenant.id, password: 'hash-only-test' } });
      const type = await prisma.type.create({ data: { name: 'Residencial', tenantId: tenant.id } });
      const territory = await prisma.territory.create({ data: { name, tenantId: tenant.id, typeId: type.id } });
      const block = await prisma.block.create({ data: { name, tenantId: tenant.id } });
      const tb = await prisma.territory_block.create({ data: { tenantId: tenant.id, territoryId: territory.id, blockId: block.id } });
      const address = await prisma.address.create({ data: { name, tenantId: tenant.id } });
      const street = await prisma.territory_block_address.create({ data: { tenantId: tenant.id, territoryBlockId: tb.id, addressId: address.id } });
      const house = await prisma.house.create({ data: { tenantId: tenant.id, territoryId: territory.id, blockId: block.id, addressId: address.id, territoryBlockAddressId: street.id, number: '10' } });
      const connection = await prisma.agent_connection.create({ data: { id: randomUUID(), userId: user.id, tenantId: tenant.id, clientId: 'test-client', clientName: 'Teste', credentialVersion: digest(user.password), scopes: ['catalog:read', 'catalog:write'], expiresAt: new Date(Date.now() + 3600000) } });
      const principal: AgentPrincipal = { userId: user.id, tenantId: tenant.id, clientId: connection.clientId, connectionId: connection.id, scopes: connection.scopes };
      return { tenant, user, type, territory, block, tb, address, street, house, principal, token: createTestToken({ userId: user.id, tenantId: tenant.id }) };
    }
    a = await seed('isolamento-a'); b = await seed('isolamento-b');
    // These tests call the catalog directly; no OAuth provider is started.
    process.env.AGENT_MCP_ENABLED = 'true';
    process.env.AGENT_MCP_ALLOWED_TENANT_IDS = `${a.tenant.id},${b.tenant.id}`;
  });
  it('rejeita IDs estrangeiros de todos os níveis e combinações de pais', async () => {
    const foreign = [
      ['get_territory', { id: b.territory.id }],
      ['get_block', { territoryId: b.territory.id, id: b.block.id }],
      ['get_block', { territoryId: a.territory.id, id: b.block.id }],
      ['get_street', { territoryId: a.territory.id, blockId: a.block.id, id: b.street.id }],
      ['get_house', { id: b.house.id }],
      ['create_block', { territoryId: b.territory.id, name: 'Negada', idempotencyKey: 'foreign-block' }],
      ['create_street', { territoryId: a.territory.id, blockId: b.block.id, name: 'Negada', idempotencyKey: 'foreign-street' }],
      ['create_house', { territoryId: a.territory.id, blockId: a.block.id, streetId: b.street.id, number: '99', idempotencyKey: 'foreign-house' }],
    ] as const;
    for (const [tool, args] of foreign) await expect(catalog.execute(a.principal, tool, args)).rejects.toThrow('Cadastro não encontrado');
    expect(await prisma.house.count({ where: { tenantId: b.tenant.id } })).toBe(1);
    expect(await prisma.agent_audit.count({ where: { tenantId: a.tenant.id, outcome: '404' } })).toBe(foreign.length);
  });
  it('protege endpoints administrativos contra roubo de quadras e casas de outro tenant', async () => {
    await request(app.getHttpServer()).get(`/v1/houses/${b.house.id}`).set('Authorization', `Bearer ${a.token}`).expect(404);
    await request(app.getHttpServer()).put(`/v1/houses/${b.house.id}`).set('Authorization', `Bearer ${a.token}`).send({ territoryId: a.territory.id, blockId: a.block.id, streetId: a.address.id, number: '1', legend: '', dontVisit: false }).expect(404);
    await request(app.getHttpServer()).post(`/v2/territories/${a.territory.id}/blocks`).set('Authorization', `Bearer ${a.token}`).send({ id: b.block.id, name: 'Tomada', addresses: [] }).expect(404);
    await request(app.getHttpServer()).post('/v1/houses').set('Authorization', `Bearer ${a.token}`).send({ territoryId: b.territory.id, blockId: b.block.id, streetId: b.address.id, number: '20', legend: '', dontVisit: false }).expect(404);
    expect((await prisma.block.findUniqueOrThrow({ where: { id: b.block.id } })).tenantId).toBe(b.tenant.id);
  });
  it('serializa cadastros repetidos e rejeita edições concorrentes com versão antiga', async () => {
    const args = { name: 'Único', typeId: a.type.id, idempotencyKey: 'parallel-create' };
    const [one, two]: any[] = await Promise.all([catalog.execute(a.principal, 'create_territory', args), catalog.execute(a.principal, 'create_territory', args)]);
    expect(one.id).toBe(two.id);
    const changes = await Promise.allSettled(['Primeiro', 'Segundo'].map((name, index) => catalog.execute(a.principal, 'update_territory', { id: one.id, expectedVersion: one.version, name, idempotencyKey: `parallel-edit-${index}` })));
    expect(changes.filter(change => change.status === 'fulfilled')).toHaveLength(1);
    expect(changes.filter(change => change.status === 'rejected')).toHaveLength(1);
  });
  it('preserva endereço compartilhado e casas ao renomear apenas um vínculo', async () => {
    const otherBlock = await prisma.block.create({ data: { tenantId: a.tenant.id, name: 'Outra' } });
    const otherTb = await prisma.territory_block.create({ data: { tenantId: a.tenant.id, territoryId: a.territory.id, blockId: otherBlock.id } });
    await prisma.territory_block_address.create({ data: { tenantId: a.tenant.id, territoryBlockId: otherTb.id, addressId: a.address.id } });
    const current: any = await catalog.execute(a.principal, 'get_street', { territoryId: a.territory.id, blockId: a.block.id, id: a.street.id });
    await catalog.execute(a.principal, 'update_street', { territoryId: a.territory.id, blockId: a.block.id, id: a.street.id, name: 'Somente nesta quadra', expectedVersion: current.version, idempotencyKey: 'local-rename' });
    expect((await prisma.address.findUniqueOrThrow({ where: { id: a.address.id } })).name).toBe('isolamento-a');
    expect(await prisma.house.count({ where: { id: a.house.id } })).toBe(1);
    expect((await prisma.house.findUniqueOrThrow({ where: { id: a.house.id } })).addressId).not.toBe(a.address.id);
  });
  it('rejeita tipo incompatível e conta alterada sem criar mutações parciais', async () => {
    const commercial = await prisma.type.create({ data: { name: 'Comercial', tenantId: a.tenant.id } });
    const row: any = await catalog.execute(a.principal, 'get_territory', { id: a.territory.id });
    await expect(catalog.execute(a.principal, 'update_territory', { id: row.id, typeId: commercial.id, expectedVersion: row.version, idempotencyKey: 'change-type' })).rejects.toThrow('Tipo não pode mudar');
    await prisma.user.update({ where: { id: a.user.id }, data: { password: 'changed-password-hash' } });
    await expect(catalog.execute(a.principal, 'get_house', { id: a.house.id })).rejects.toThrow('Conexão revogada');
    expect((await prisma.territory.findUniqueOrThrow({ where: { id: row.id } })).typeId).toBe(a.type.id);
  });
});
