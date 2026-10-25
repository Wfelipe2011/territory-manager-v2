const { test } = require('node:test');
const assert = require('node:assert/strict');
const { install } = require('../read-model.cjs');
test('raw read model is versioned, persisted after commit, omits tokens and recomputes each response', async () => {
  const stored = new Map(); let revision = '1', builds = 0, renders = 0, active = false, token = 'first';
  const user = { tenantId: 1, territoryId: 2, roles: ['publisher'] }, scope = { blockId: 3, round: 8 }, info = { status: 'open' };
  const aggregate = {};
  const connection = { async query(text, values) {
    if (text.includes('FROM field_revision')) return { rows: [{ round_number: 0, revision }, { round_number: 8, revision }] };
    if (text.includes('FROM field_read_model')) return { rows: stored.has(JSON.stringify(values)) ? [{ payload: structuredClone(stored.get(JSON.stringify(values))) }] : [] };
    if (text === 'BUILD') { builds++; return { rows: [{ payload: { block: { _signature: { token: 'never-persist' } }, streets: [] } }] }; }
    if (text.includes('FROM territory_block')) return { rows: [{ token, expirationDate: new Date(Date.now() + 10000) }] };
    throw Error(text);
  } };
  const tx = { $blockSnapshot: (...args) => aggregate.snapshot(connection, ...args) };
  const db = { async $transaction(work) { active = true; try { return await work(tx); } finally { active = false; } }, async $storeReadModel(values) { assert.equal(active, false); stored.set(JSON.stringify(values.slice(0, 5)), JSON.parse(values[5])); } };
  const model = install(db, async (fake, ...args) => { renders++; return (await fake.query('BUILD', args)).rows[0].payload; }, 'BUILD');
  aggregate.snapshot = model.read;
  const read = () => db.$transaction(tx => tx.$blockSnapshot(user, scope, info), { isolationLevel: 'RepeatableRead' });
  const a = await read(); token = 'second'; const b = await read();
  assert.equal(a.block._signature.token, 'first'); assert.equal(b.block._signature.token, 'second');
  assert.equal(builds, 1); assert.equal(renders, 2);
  assert([...stored.values()].every(row => row.block._signature === null));
  revision = '2'; await read(); assert.equal(builds, 2);
  assert.equal(model.stats().hits, 1); assert.equal(model.stats().misses, 2);
  model.close();
});

test('observed scopes are bounded and idle observations expire', async () => {
  const db={async $transaction(work){return work({});},async $pruneReadModels(){return {rowCount:0};}};
  const connection={async query(text){
    if(text.includes('SELECT round_number'))return {rows:[]};
    if(text.includes('SELECT payload'))return {rows:[]};
    if(text==='BUILD')return {rows:[{payload:{streets:[]}}]};
    throw Error('Unexpected SQL');
  }};
  const model=install(db,async(fake)=>(await fake.query('BUILD')).rows[0].payload,'BUILD');
  for(let blockId=1;blockId<=600;blockId++)await model.read(connection,{tenantId:1,territoryId:2,round:8,roles:['publisher']},{blockId,round:8},null);
  assert.equal(model.stats().watched,512);
  assert.equal(model.stats().evictedScopes,88);
  const now=Date.now;
  try{Date.now=()=>now()+11*60*1000;await model.prune();}
  finally{Date.now=now;}
  assert.equal(model.stats().watched,0);
  model.close();
});
