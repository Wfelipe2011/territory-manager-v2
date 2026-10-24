import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/infra/prisma/prisma.service';
import { createTestToken } from './auth-helper';
import { randomUUID } from 'crypto';

export async function requestFixture(app: INestApplication, edit = true) {
  const prisma = app.get(PrismaService),
    server = app.getHttpServer();
  const tenant = await prisma.multitenancy.create({ data: { name: 'QA Solicitações', city: 'Sorocaba', state: 'SP' } });
  const type = await prisma.type.create({ data: { name: 'Residencial', tenantId: tenant.id } });
  const territory = await prisma.territory.create({ data: { name: 'Território vazio', typeId: type.id, tenantId: tenant.id } });
  const admin = createTestToken({ tenantId: tenant.id });
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const link = await request(server)
    .post(`/v1/territories/${territory.id}/signature`)
    .set(auth(admin))
    .send({ overseer: 'Dirigente QA', expirationTime: '2099-12-31', canEditStructure: edit })
    .expect(201);
  const leader = (await request(server).get(`/v1/signature/${link.body.signature}`).expect(200)).body.token;
  const create = async (entity: string, data: any, scope: any = {}, action = 'create', token = leader) => {
    const response = await request(server)
      .post('/v1/change-requests')
      .set(auth(token))
      .send({ entity, action, territoryId: territory.id, ...scope, data, observations: 'Conferido em campo' });
    if (response.status !== 201) throw new Error(`Criar ${entity}: ${response.status} ${JSON.stringify(response.body)}`);
    return response.body;
  };
  const review = (rows: any[], decision = 'approve', extra: any = {}) =>
    request(server)
      .post('/v1/change-requests/review')
      .set(auth(admin))
      .send({
        decision,
        items: rows.map(r => ({ id: r.id, version: r.version, ...(r.impact ? { impactToken: r.impact.token } : {}) })),
        reason: 'Cadastro rejeitado no teste',
        ...extra,
      });
  const tree = async () => {
    const block = await create('block', { name: 'Quadra nova' });
    const street = await create('street', { name: 'Rua nova' }, { blockId: block.targetId });
    const house = await create('house', { number: '10' }, { blockId: block.targetId, addressId: street.addressId });
    return { block, street, house };
  };
  const snapshot = async (blockId: number, token = leader) =>
    (await request(server).get(`/v1/field/blocks/${blockId}/sync`).set(auth(token)).query({ clientId: randomUUID(), tabId: randomUUID() }).expect(200)).body;
  return { prisma, server, tenant, type, territory, admin, leader, code: link.body.signature, auth, create, review, tree, snapshot };
}
