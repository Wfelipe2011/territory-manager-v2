// Runs inside the synthetic network, against ONE worker and the untouched API image.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { assertSynthetic, provenance } = require('../shared/core.cjs');
assertSynthetic();
const variant = process.env.LAB_VARIANT;
assert(['bun', 'nest'].includes(variant));
const fixture = JSON.parse(fs.readFileSync('/output/fixture-peak.json'));
assert.equal(fixture.name, 'territory-load-peak-v1');
const db = new PrismaClient();
const block = fixture.blocks[0];
const clientId = 'lab-' + randomUUID();
const tabId = 'lab-' + randomUUID();
const session = `clientId=${clientId}&tabId=${tabId}`;
const path = (b = block) => `/v1/field/blocks/${b.blockId}/sync`;
const urls = ['http://api:3000', 'http://proxy:8080'];
const cases = [];
const sign = (payload, options = {}) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h', ...options });
const principal = jwt.decode(block.token);
const { iat, exp, ...claims } = principal;
const temporaryKeys = [];

async function request(base, route, { token = block.token, method = 'GET', headers = {}, signal, body:requestBody } = {}) {
  const response = await fetch(base + route, {
    method, body:requestBody===undefined?undefined:JSON.stringify(requestBody), signal: signal || AbortSignal.timeout(45000),
    headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (body && typeof body === 'object' && body.timestamp) delete body.timestamp;
  return { status: response.status, body, cache: response.headers.get('cache-control') };
}

async function equivalent(name, route, options = {}, expected = 200) {
  const results = [];
  for (const base of urls) results.push(await request(base, route, options));
  assert.equal(results[0].status, expected, name + ': reference status');
  assert.deepEqual(results[1], results[0], name);
  cases.push({ name, status: expected, equal: true });
  return results[1].body;
}

async function grant(payload, expirationDate = new Date(Date.now() + 3600000)) {
  const key = 'LAB-' + randomUUID();
  temporaryKeys.push(key);
  const token = sign({ ...payload, id: key });
  await db.signature.create({ data: { key, token, tenantId: payload.tenantId, expirationDate } });
  return { key, token };
}

async function main() {
  const health = await (await fetch('http://proxy:8080/healthz')).json();
  assert.deepEqual(health.source, provenance(), 'Worker and reference image source hashes');
  for (const b of fixture.blocks.slice(0, 12)) {
    await equivalent('publisher tenant ' + b.tenantId, path(b) + '?' + session, { token: b.token });
  }
  await Promise.all(fixture.blocks.slice(0,2).map(b=>equivalent('congregações paralelas isoladas '+b.tenantId,path(b)+'?'+session,{token:b.token})));
  const initial = await equivalent('initial snapshot', path() + '?' + session);
  assert.equal(initial.changed, true);
  assert(initial.data.streets.some(street => street.houses.length));
  await equivalent('missing JWT', path() + '?' + session, { token: null }, 401);
  await equivalent('malformed JWT', path() + '?' + session, { token: 'invalid' }, 401);
  await equivalent('expired JWT', path() + '?' + session, { token: sign(claims, { expiresIn: -1 }) }, 401);
  await equivalent('bad JWT signature', path() + '?' + session, { token: jwt.sign(claims, 'wrong-secret') }, 401);
  await equivalent('unauthorized role', path() + '?' + session, { token: sign({ ...claims, roles: ['admin'] }) }, 403);
  await equivalent('grant claims mismatch', path() + '?' + session, { token: sign({ ...claims, round: 7 }) }, 403);
  await equivalent('other tenant block', path(fixture.blocks[1]) + '?' + session, {}, 403);
  await equivalent('path scope cannot be overwritten', path() + '?' + session + '&blockId=2', {}, 403);
  await equivalent('invalid identifier', '/v1/field/blocks/NaN/sync?' + session, {}, 400);
  await equivalent('unsafe identifier', '/v1/field/blocks/9007199254740992/sync?' + session, {}, 400);
  await equivalent('missing session', path(), {}, 400);
  await equivalent('duplicate query identity', path() + '?' + session + '&clientId=bad', {}, 400);
  await equivalent('valid address query scope', path() + '?' + session + '&addressId=' + block.firstAddress);
  await equivalent('forbidden address scope', path() + '?' + session + '&addressId=999999', {}, 403);
  await equivalent('cookie authentication', path() + '?' + session, { token: null, headers: { Cookie: 'access_token=' + block.token } });
  await equivalent('HTML unauthorized error view', path() + '?' + session, { token: null, headers: { Accept: 'text/html' } }, 401);
  await equivalent('generic field sync', '/v1/field/sync?' + session + '&scope=block&blockId=' + block.blockId);
  await equivalent('publisher territory forbidden', '/v1/field/sync?' + session + '&scope=territory', {}, 403);

  const overseer = await grant({ ...claims, blockId: undefined, roles: ['overseer'] });
  await db.signature.update({ where: { key: overseer.key }, data: { canEditStructure: true } });
  const editable = await equivalent('overseer permissions', path() + '?' + session, { token: overseer.token });
  assert.equal(editable.data.capabilities.canEditStructure, true);
  const dynamicRound = await grant({ ...claims, round: null });
  await equivalent('catalog resolves current round', path() + '?' + session, { token: dynamicRound.token });
  const closedRound = await grant({ ...claims, round: 7 });
  const closed = await equivalent('closed round permissions', path() + '?' + session, { token: closedRound.token });
  assert(closed.data.streets.flatMap(street => street.houses).every(house => house.readOnly));

  const catalogHouse = await db.house.findUniqueOrThrow({ where: { id: block.firstHouse } });
  const ordered = await db.house.findMany({where:{tenantId:block.tenantId,blockId:block.blockId},orderBy:{id:'asc'},take:8});
  try {
    const numbers=['12','10','2A','2','02','1','2-1','3/1'];
    for(let i=0;i<ordered.length;i++) await db.house.update({where:{id:ordered[i].id},data:{number:numbers[i],order:i===1?0:null}});
    const sorted=await equivalent('ordem manual, complementos numéricos e zeros à esquerda',path()+'?'+session);
    const houses=sorted.data.streets.flatMap(s=>s.houses).filter(h=>ordered.some(o=>o.id===h.id));
    assert.deepEqual(houses.map(h=>h.number),['10','1','2','02','2-1','2A','3/1','12']);
  } finally {
    for(const original of ordered) await db.house.update({where:{id:original.id},data:{number:original.number,order:original.order}});
  }
  const addresses=await db.address.findMany({where:{tenantId:block.tenantId,id:{in:[block.firstAddress,block.firstAddress+1,block.firstAddress+2]}}});
  try {
    const names=['Água 2','água 10','Agua 1'];
    for(let i=0;i<addresses.length;i++)await db.address.update({where:{id:addresses[i].id},data:{name:names[i]}});
    await equivalent('ordenação de ruas com acentos e diferenças de caixa',path()+'?'+session);
    for(const row of addresses)await db.address.update({where:{id:row.id},data:{name:'Rua Igual'}});
    await equivalent('nomes de ruas iguais preservam a ordem legada',path()+'?'+session);
  } finally {for(const row of addresses)await db.address.update({where:{id:row.id},data:{name:row.name}});}
  const mapping = await db.territory_block_address.findUniqueOrThrow({ where: { id: catalogHouse.territoryBlockAddressId } });
  const link = await db.territory_block.findUniqueOrThrow({ where: { id: mapping.territoryBlockId } });
  let proposal;
  try {
    await db.house.update({ where: { id: catalogHouse.id }, data: { registrationStatus: 'pending', dontVisit: true } });
    await db.territory_block_address.update({ where: { id: mapping.id }, data: { registrationStatus: 'pending' } });
    await db.territory_block.update({ where: { id: link.id }, data: { registrationStatus: 'pending' } });
    proposal = await db.change_request.create({ data: {
      tenantId: block.tenantId, territoryId: block.territoryId, blockId: block.blockId,
      entity: 'house', action: 'create', targetId: catalogHouse.id, proposedData: {}, observations: 'Lab equivalence only',
    } });
    const pending = await equivalent('provisional parents house and pending request', path() + '?' + session);
    const pendingHouse = pending.data.streets.flatMap(street => street.houses).find(house => house.id === catalogHouse.id);
    assert.equal(pendingHouse.pendingRequest.id, proposal.id);
    assert.equal(pendingHouse.hasRound, true);
    const provisionalRound=await db.round.findFirstOrThrow({where:{houseId:catalogHouse.id,tenantId:block.tenantId,roundNumber:8}});
    try {
      await db.house.update({where:{id:catalogHouse.id},data:{dontVisit:false}});
      await db.round.update({where:{id:provisionalRound.id},data:{completed:false,completedDate:null}});
      const workable=await equivalent('casa provisória livre permite marcação',path()+'?'+session);
      assert(workable.data.streets.flatMap(s=>s.houses).find(h=>h.id===catalogHouse.id).canMark);
      const markRoute=`/v1/territories/${block.territoryId}/blocks/${block.blockId}/address/${catalogHouse.addressId}/houses/${catalogHouse.id}`;
      const marked=await request(urls[0],markRoute,{method:'PATCH',headers:{'Content-Type':'application/json'},body:{round:8,status:true}});
      assert.equal(marked.status,200,'Normal API marks provisional house');
      const worked=await equivalent('marcação HTTP de provisória aparece no snapshot',path()+'?'+session);
      assert(worked.data.streets.flatMap(s=>s.houses).find(h=>h.id===catalogHouse.id).status);
    } finally {
      await db.round.update({where:{id:provisionalRound.id},data:{completed:provisionalRound.completed,completedDate:provisionalRound.completedDate,updateDate:provisionalRound.updateDate}});
      await db.house.update({where:{id:catalogHouse.id},data:{dontVisit:true}});
    }

    await db.house.update({ where: { id: catalogHouse.id }, data: { territoryBlockAddressId: null } });
    await equivalent('legacy house without normalized mapping', path() + '?' + session);
    let legacyStreet,duplicateStreet;
    try {
      await db.territory_block_address.update({where:{id:mapping.id},data:{registrationStatus:'rejected'}});
      legacyStreet=await db.change_request.create({data:{tenantId:block.tenantId,territoryId:block.territoryId,blockId:block.blockId,entity:'street',action:'create',targetId:null,proposedData:{},observations:'Lab legacy street only'}});
      await equivalent('rua legada sem vínculo mantém solicitação de alvo nulo',path()+'?'+session);
      duplicateStreet=await db.change_request.create({data:{tenantId:block.tenantId,territoryId:block.territoryId,blockId:block.blockId,entity:'street',action:'update',targetId:null,proposedData:{},observations:'Lab duplicate null target only'}});
      await equivalent('solicitações de alvo nulo duplicadas preservam montagem original',path()+'?'+session);
    } finally {
      if(duplicateStreet)await db.change_request.delete({where:{id:duplicateStreet.id}});
      if(legacyStreet)await db.change_request.delete({where:{id:legacyStreet.id}});
      await db.territory_block_address.update({where:{id:mapping.id},data:{registrationStatus:'pending'}});
    }

    await db.house.update({ where: { id: catalogHouse.id }, data: { registrationStatus: 'rejected' } });
    const rejected = await equivalent('rejected house excluded', path() + '?' + session);
    assert(!rejected.data.streets.flatMap(street => street.houses).some(house => house.id === catalogHouse.id));
    await db.territory_block.update({ where: { id: link.id }, data: { registrationStatus: 'rejected' } });
    await equivalent('rejected block denies signature', path() + '?' + session, {}, 403);
  } finally {
    if (proposal) await db.change_request.delete({ where: { id: proposal.id } });
    await db.house.update({ where: { id: catalogHouse.id }, data: {
      registrationStatus: catalogHouse.registrationStatus, dontVisit: catalogHouse.dontVisit,
      territoryBlockAddressId: catalogHouse.territoryBlockAddressId,
    } });
    await db.territory_block_address.update({ where: { id: mapping.id }, data: { registrationStatus: mapping.registrationStatus } });
    await db.territory_block.update({ where: { id: link.id }, data: { registrationStatus: link.registrationStatus } });
  }
  let emptyInfo;
  try {
    emptyInfo = await db.round_info.create({ data: {
      tenantId: block.tenantId, roundNumber: 900001, name: 'Lab empty round', theme: 'default', typeIds: [], status: 'uninitialized', type: 'Residencial',
    } });
    const emptyGrant = await grant({ ...claims, round: emptyInfo.roundNumber });
    const empty = await equivalent('empty round catalog retained', path() + '?' + session, { token: emptyGrant.token });
    assert.equal(empty.data.workRoundNumber, emptyInfo.roundNumber);
    assert(empty.data.streets.flatMap(street => street.houses).every(house => !house.hasRound && !house.canMark && !house.canUnmark));
  } finally {
    if (emptyInfo) await db.round_info.delete({ where: { id: emptyInfo.id } });
  }
  const expired = await grant(claims, new Date(Date.now() - 60000));
  await equivalent('expired database signature', path() + '?' + session, { token: expired.token }, 403);
  const revoked = await grant(claims);
  await db.signature.delete({ where: { key: revoked.key } });
  await equivalent('revoked signature', path() + '?' + session, { token: revoked.token }, 403);

  // Both execute the real 25-second unchanged branch, concurrently for identical presence.
  const unchangedInitial = await equivalent('unchanged preparation', path() + '?' + session);
  const cursorRoute = path() + '?' + session + '&cursor=' + encodeURIComponent(unchangedInitial.cursor);
  const started = Date.now();
  const unchanged = await Promise.all(urls.map(base => request(base, cursorRoute)));
  assert(Date.now() - started >= 24500, 'Long polling must not return early');
  assert.deepEqual(unchanged[1], unchanged[0]);
  assert.equal(unchanged[1].body.changed, false);
  cases.push({ name: '25-second unchanged timeout', status: 200, equal: true });

  // Revocation MUST be revalidated DURING the wait, not only on admission.
  for (const base of urls) {
    const live = await grant(claims);
    const first = await request(base, path() + '?' + session, { token: live.token });
    const pending = request(base, path() + '?' + session + '&cursor=' + encodeURIComponent(first.body.cursor), { token: live.token });
    await new Promise(resolve => setTimeout(resolve, 500));
    await db.signature.delete({ where: { key: live.key } });
    const denied = await pending;
    assert.equal(denied.status, 403, 'Revocation while waiting');
  }
  cases.push({ name: 'revocation during long polling', status: 403, equal: true });

  // A real database mutation must wake both readers and expose the same house status.
  const house = await db.round.findFirstOrThrow({ where: { houseId: block.firstHouse, tenantId: block.tenantId, roundNumber: 8 } });
  const before = await equivalent('before mutation', path() + '?' + session);
  const route = path() + '?' + session + '&cursor=' + encodeURIComponent(before.cursor);
  const waiting = urls.map(base => request(base, route));
  try {
    await new Promise(resolve => setTimeout(resolve, 500));
    await db.round.update({ where: { id: house.id }, data: { completed: !house.completed, completedDate: new Date() } });
    const observed = await Promise.all(waiting);
    assert.deepEqual(observed[1], observed[0], 'Changed snapshot');
    assert.equal(observed[1].body.changed, true);
    const updated = observed[1].body.data.streets.flatMap(street => street.houses).find(row => row.id === block.firstHouse);
    assert.equal(updated.status, !house.completed);
    cases.push({ name: 'mutation wakes long polling with consistent snapshot', status: 200, equal: true });
  } finally {
    await db.round.update({ where: { id: house.id }, data: { completed: house.completed, completedDate: house.completedDate } });
    await Promise.allSettled(waiting);
  }

  for (const base of urls) {
    const current = await request(base, path() + '?' + session);
    const abort = new AbortController();
    const pending = request(base, path() + '?' + session + '&cursor=' + encodeURIComponent(current.body.cursor), { signal: abort.signal });
    setTimeout(() => abort.abort(), 300);
    await assert.rejects(pending, error => error.name === 'AbortError');
  }
  cases.push({ name: 'client disconnect accepted', equal: true, limitation: 'Client cancellation tested; not a server-side leak proof' });
  await equivalent('explicit session leave', '/v1/field/session?' + session, { method: 'DELETE' });
  // Leave is tenant-scoped and idempotent; other tenants' test sessions are untouched.
  assert.equal(await db.$queryRaw`SELECT count(*)::int AS count FROM field_session WHERE tenant_id=${block.tenantId} AND client_id=${clientId} AND disconnected_at IS NULL`.then(rows => rows[0].count), 0);
  const finalHealth=await (await fetch('http://proxy:8080/healthz')).json();
  if(finalHealth.batchValidation) {
    assert(finalHealth.stats.validationBatch.statements>0,'Validation SQL optimization must really execute');
    assert(finalHealth.stats.validationBatch.territoryReuses>0 && finalHealth.stats.validationBatch.linkReuses>0,'Original validation must consume joined scope reads');
    assert.equal(finalHealth.stats.validationBatch.invocations,finalHealth.stats.validationBatch.statements,'One fresh statement per validation invocation');
    cases.push({name:'uma consulta nova por validação, sem cache entre chamadas',equal:true});
  }
  const output = { variant, checkedAt: new Date().toISOString(), passed: cases.length, cases, source: health.source };
  fs.writeFileSync('/output/equivalence-' + variant + '.json', JSON.stringify(output, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ variant, passed: cases.length }));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await db.$executeRaw`DELETE FROM field_session WHERE client_id=${clientId}`;
  await db.signature.deleteMany({ where: { key: { in: temporaryKeys } } });
  await db.$disconnect();
});
