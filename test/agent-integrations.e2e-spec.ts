import { INestApplication } from '@nestjs/common';
import { createHash, randomBytes, generateKeyPairSync } from 'crypto';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { createTestApp } from './utils/app-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { createTestToken } from './utils/auth-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';

const origin = 'http://127.0.0.1:3105';
const resource = `${origin}/mcp`;
const callback = 'http://localhost:9191/callback';
const path = (url: string) => { const parsed = new URL(url, origin); return parsed.pathname + parsed.search; };
const input = (html: string, name: string) => html.match(new RegExp(`name="${name}" value="([^"]+)"`))![1];

describe('Integração pública MCP/OAuth com tenants isolados', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let a: any;
  let b: any;
  let admin: string;
  const prior = { ...process.env };

  beforeAll(async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    Object.assign(process.env, {
      AGENT_MCP_ENABLED: 'true', AGENT_PUBLIC_ORIGIN: origin,
      AGENT_OAUTH_ENCRYPTION_KEY: randomBytes(32).toString('hex'), AGENT_OAUTH_COOKIE_KEYS: randomBytes(32).toString('hex'),
      AGENT_OAUTH_JWKS: JSON.stringify({ keys: [{ ...privateKey.export({ format: 'jwk' }), kid: 'test-only', alg: 'RS256', use: 'sig' }] }),
      AGENT_OAUTH_CLIENTS: JSON.stringify([{ client_id: 'agent-test', client_name: 'Agente de teste', redirect_uris: [callback], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }]),
    });
    app = await createTestApp(); prisma = app.get(PrismaService);
  });
  afterAll(async () => { if (app) await app.close(); for (const key of Object.keys(process.env)) if (key.startsWith('AGENT_')) delete process.env[key]; Object.assign(process.env, prior); });
  beforeEach(async () => {
    await cleanDatabase(prisma);
    async function seed(name: string) {
      const tenant = await prisma.multitenancy.create({ data: { name } });
      const user = await prisma.user.create({ data: { tenantId: tenant.id, email: `${name}@local.test`, name, password: await bcrypt.hash('test-password', 4) } });
      const type = await prisma.type.create({ data: { tenantId: tenant.id, name: 'Residencial' } });
      const territory = await prisma.territory.create({ data: { tenantId: tenant.id, name: `Território ${name}`, typeId: type.id } });
      return { tenant, user, type, territory };
    }
    a = await seed('mcp-a'); b = await seed('mcp-b');
    admin = createTestToken({ tenantId: a.tenant.id, userId: a.user.id });
  });

  async function authorize(who = a, scopes = 'catalog:read catalog:write offline_access') {
    const agent = request.agent(app.getHttpServer());
    const verifier = randomBytes(32).toString('base64url');
    const authQuery = { client_id: 'agent-test', response_type: 'code', scope: scopes, redirect_uri: callback, resource, state: 'state-test', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' };
    let response = await agent.get('/oauth/auth').query(authQuery).expect(303);
    let location = path(response.headers.location);
    response = await agent.get(location).expect(200);
    response = await agent.post(location).type('form').send({ csrf: input(response.text, 'csrf'), email: who.user.email, password: 'test-password' }).expect(303);
    response = await agent.get(path(response.headers.location)).expect(303);
    location = path(response.headers.location);
    response = await agent.get(location).expect(200);
    expect(response.text).toContain(who.tenant.name);
    response = await agent.post(location).type('form').send({ csrf: input(response.text, 'csrf'), consentBinding: input(response.text, 'consentBinding'), decision: 'allow' }).expect(303);
    response = await agent.get(path(response.headers.location)).expect(303);
    const redirect = new URL(response.headers.location);
    expect(redirect.searchParams.get('state')).toBe('state-test');
    expect(redirect.searchParams.get('iss')).toBe(`${origin}/oauth`);
    const code = redirect.searchParams.get('code')!;
    const tokens = await request(app.getHttpServer()).post('/oauth/token').type('form').send({ grant_type: 'authorization_code', client_id: 'agent-test', redirect_uri: callback, code, code_verifier: verifier, resource }).expect(200);
    return { ...tokens.body, code, verifier };
  }
  async function mcp(token: string, name: string, args: object = {}) {
    const response = await request(app.getHttpServer()).post('/mcp').set('Authorization', `Bearer ${token}`).set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).expect(200);
    return response.body.result;
  }

  it('descobre OAuth, conecta por PKCE e rejeita tokens administrativos e acesso anônimo', async () => {
    const metadata = await request(app.getHttpServer()).get('/.well-known/oauth-protected-resource').expect(200);
    expect(metadata.body.resource).toBe(resource);
    await request(app.getHttpServer()).get('/oauth/.well-known/openid-configuration').expect(200);
    const invalidClient = await request(app.getHttpServer()).get('/oauth/auth').query({ client_id: 'unregistered-client', response_type: 'code' }).set('Accept', 'text/html').expect(400);
    expect(invalidClient.text).toContain('Conexão não autorizada');
    expect(invalidClient.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer()).post('/mcp').send({}).expect(401).expect('WWW-Authenticate', /resource_metadata/);
    await request(app.getHttpServer()).post('/mcp').set('Authorization', `Bearer ${admin}`).send({}).expect(401);
    const tokens = await authorize();
    const initialize = await request(app.getHttpServer()).post('/mcp').set('Authorization', `Bearer ${tokens.access_token}`).set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 10, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'integration-test', version: '1' } } }).expect(200);
    expect(initialize.body.result.serverInfo.name).toBe('territorio-digital');
    const discovery = await request(app.getHttpServer()).post('/mcp').set('Authorization', `Bearer ${tokens.access_token}`).set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 11, method: 'tools/list' }).expect(200);
    expect(discovery.body.result.tools).toHaveLength(18);
    expect(discovery.body.result.tools.find((tool: any) => tool.name === 'create_house').securitySchemes[0].scopes).toEqual(['catalog:write']);
    expect((await mcp(tokens.access_token, 'connection_context')).structuredContent.result.congregation).toBe(a.tenant.name);
    const artifacts = await prisma.agent_oauth_artifact.findMany();
    expect(JSON.stringify(artifacts)).not.toContain(tokens.access_token);
    const replay = await request(app.getHttpServer()).post('/oauth/token').type('form').send({ grant_type: 'authorization_code', client_id: 'agent-test', redirect_uri: callback, code: tokens.code, code_verifier: tokens.verifier, resource });
    expect(replay.status).toBe(400);
  });

  it('isola tenants em leituras, tipos, vínculos e atualizações REST/MCP', async () => {
    const tokens = await authorize();
    const list = await mcp(tokens.access_token, 'list_territories');
    expect(list.structuredContent.result.data.map((row: any) => row.id)).toEqual([a.territory.id]);
    expect((await mcp(tokens.access_token, 'get_territory', { id: b.territory.id })).isError).toBe(true);
    expect((await mcp(tokens.access_token, 'create_territory', { name: 'Inválido', typeId: b.type.id, idempotencyKey: 'foreign-type' })).isError).toBe(true);
    await request(app.getHttpServer()).put(`/v1/territories/${b.territory.id}`).set('Authorization', `Bearer ${admin}`).send({ id: b.territory.id, name: 'Inválido', typeId: a.type.id }).expect(404);
    const other = createTestToken({ tenantId: b.tenant.id, userId: b.user.id });
    const first = await request(app.getHttpServer()).get('/v1/addresses').set('Authorization', `Bearer ${admin}`).expect(200);
    await prisma.address.create({ data: { name: 'Exclusivo B', tenantId: b.tenant.id } });
    const second = await request(app.getHttpServer()).get('/v1/addresses').set('Authorization', `Bearer ${other}`).expect(200);
    expect(first.body).toEqual([]); expect(second.body[0].name).toBe('Exclusivo B');
  });

  it('cadastra a estrutura, preserva casas nas edições e detecta repetição e versão antiga', async () => {
    const tokens = await authorize();
    const run = async (name: string, args: any) => { const result = await mcp(tokens.access_token, name, args); expect(result.isError).not.toBe(true); return result.structuredContent.result; };
    const block = await run('create_block', { territoryId: a.territory.id, name: 'Quadra A', idempotencyKey: 'new-block' });
    const parents = { territoryId: a.territory.id, blockId: block.id };
    const street = await run('create_street', { ...parents, name: 'Rua A', idempotencyKey: 'new-street' });
    const params = { ...parents, streetId: street.id, number: '10', idempotencyKey: 'new-house' };
    const house = await run('create_house', params);
    expect((await run('create_house', params)).id).toBe(house.id);
    expect(await prisma.house.count({ where: { tenantId: a.tenant.id, number: '10' } })).toBe(1);
    expect(house.affectedRoundNumbers.length).toBe(1);
    const renamed = await run('update_street', { ...parents, id: street.id, name: 'Rua Renomeada', expectedVersion: street.version, idempotencyKey: 'rename-street' });
    expect(renamed.id).toBe(street.id);
    expect(await prisma.round.count({ where: { tenantId: a.tenant.id, houseId: house.id } })).toBe(1);
    expect((await run('list_houses', { ...parents, streetId: street.id })).data[0].id).toBe(house.id);
    await run('update_block', { territoryId: a.territory.id, id: block.id, name: 'Nova Quadra', expectedVersion: block.version, idempotencyKey: 'rename-block' });
    expect((await mcp(tokens.access_token, 'update_block', { territoryId: a.territory.id, id: block.id, name: 'Concorrente', expectedVersion: block.version, idempotencyKey: 'stale-block' })).isError).toBe(true);
    expect((await mcp(tokens.access_token, 'create_house', { ...params, number: '11' })).isError).toBe(true);
  });

  it('limita escopos, rotaciona refresh tokens e impede reutilização', async () => {
    const tokens = await authorize(a, 'catalog:read offline_access');
    expect((await mcp(tokens.access_token, 'create_territory', { name: 'Negado', typeId: a.type.id, idempotencyKey: 'no-write' })).isError).toBe(true);
    const refresh = () => request(app.getHttpServer()).post('/oauth/token').type('form').send({ grant_type: 'refresh_token', client_id: 'agent-test', refresh_token: tokens.refresh_token, resource });
    const next = await refresh().expect(200);
    expect(next.body.refresh_token).not.toBe(tokens.refresh_token);
    await refresh().expect(400);
    await request(app.getHttpServer()).post('/mcp').set('Authorization', `Bearer ${next.body.access_token}`).send({}).expect(401);
  });

  it('revoga imediatamente e rejeita mudança de congregação na conta conectada', async () => {
    const tokens = await authorize();
    const list = await request(app.getHttpServer()).get('/v1/agent-integrations').set('Authorization', `Bearer ${admin}`).expect(200);
    await request(app.getHttpServer()).delete(`/v1/agent-integrations/${list.body.connections[0].id}`).set('Authorization', `Bearer ${admin}`).expect(200);
    await request(app.getHttpServer()).post('/mcp').set('Authorization', `Bearer ${tokens.access_token}`).send({}).expect(401);
    const another = await authorize();
    await prisma.user.update({ where: { id: a.user.id }, data: { tenantId: b.tenant.id } });
    await request(app.getHttpServer()).post('/mcp').set('Authorization', `Bearer ${another.access_token}`).send({}).expect(401);
  });
});
