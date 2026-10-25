const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transform}=require('../experiments/candidates.cjs');
const filename=path.resolve(__dirname,'../read-model.cjs'),source=fs.readFileSync(filename,'utf8');
function installFor(variant){const m=new Module(filename,module);m.filename=filename;m.paths=module.paths;m._compile(transform('read-model.cjs',source,variant),filename);return m.exports.install;}
for(const variant of ['control','copies','roundtrips'])test(variant+': raw versions remain private, immutable and omit tokens',async()=>{
  const stored=new Map();let revision='1',token='first',committed=false,queries=0;
  const connection={async query(sql,key){queries++;
    if(sql.includes('SELECT round_number'))return {rows:[{round_number:0,revision}]};
    if(sql.includes('FROM field_read_model'))return {rows:[{payload:stored.has(key[4])?structuredClone(stored.get(key[4])):null,signature:{token,expirationDate:'2030-01-01T00:00:00.000Z'}}]};
    if(sql==='BUILD')return {rows:[{payload:{block:{_signature:{token}},streets:[{houses:[{number:'10'}]}]}}]};
    if(sql.includes('FROM territory_block'))return {rows:[{token}]};
    throw Error(sql);
  }};
  const db={async $transaction(work){committed=false;const v=await work(connection);committed=true;return v;},async $storeReadModel(row){assert(committed);stored.set(row[4],JSON.parse(row[5]));}};
  const model=installFor(variant)(db,async fake=>{const p=(await fake.query()).rows[0].payload;p.streets[0].houses[0].number+=' changed';return p;},'BUILD');
  const read=()=>db.$transaction(c=>model.read(c,{tenantId:1,territoryId:2,roles:['publisher']},{blockId:3,round:8},null));
  const a=await read();token='second';const before=queries,b=await read();
  assert.equal(a.block._signature.token,'first');assert.equal(b.block._signature.token,'second');
  assert.equal(b.streets[0].houses[0].number,'10 changed');
  b.streets[0].houses[0].number='mutated';assert.equal(a.streets[0].houses[0].number,'10 changed');
  assert([...stored.values()].every(p=>p.block._signature===null&&p.streets[0].houses[0].number==='10'));
  assert.equal(queries-before,variant==='roundtrips'?2:3);
  revision='2';await read();assert.equal(stored.size,2);model.close();
});
test('candidate transforms refuse changed source instead of silently disabling a variant',()=>{
  assert.throws(()=>transform('read-model.cjs','changed','copies'));
  assert.throws(()=>transform('read-model.cjs','changed','roundtrips'));
  assert.throws(()=>transform('pg-adapter.cjs','changed','native'));
});
