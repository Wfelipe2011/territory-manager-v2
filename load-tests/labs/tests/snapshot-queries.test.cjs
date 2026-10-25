const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('../bun/snapshot-queries.cjs');
const args={select:{id:true,address:{select:{name:true}},rounds:{take:1,where:{roundNumber:8},select:{completed:true,completedDate:true,endDate:true,leaveLetter:true}}}};
test('junções preservam escopo e uma participação sem duplicar casas',async()=>{
 let statement,values;
 const connection={query:async(s,p)=>{statement=s;values=p;return{rows:[{id:1,_addressName:'Rua',_roundId:3,_completed:true,_completedDate:new Date('2026-01-01Z'),_endDate:null,_leaveLetter:false}]};}};
 const rows=await load(connection,'house',args,'SELECT id,address_id AS "addressId" FROM house WHERE tenant_id=$1',[7],'joined');
 assert(statement.includes('tenant_id=$1'));assert(statement.includes('ORDER BY id LIMIT 1'));assert.deepEqual(values,[7,8]);
 assert.equal(rows.length,1);assert.equal(rows[0].rounds[0].completed,true);assert(!Object.keys(rows[0]).some(k=>k.startsWith('_')));
});
test('datas agregadas são UTC e ausência de rodada preserva lista vazia',async()=>{
 const connection={query:async()=>({rows:[{id:1,address:{name:'Rua'},rounds:[{completedDate:'2026-01-01T12:30:00',endDate:null}]},{id:2,address:{name:'Rua'},rounds:[]}]})};
 const rows=await load(connection,'house',args,'SELECT id FROM house',[],'aggregate');
 assert.equal(rows[0].rounds[0].completedDate.toISOString(),'2026-01-01T12:30:00.000Z');assert.deepEqual(rows[1].rounds,[]);
});
test('seleção desconhecida de participação mantém o carregador original',async()=>{
 const connection={query:async()=>{throw Error('must not run');}};
 assert.equal(await load(connection,'house',{select:{...args.select,rounds:{...args.select.rounds,select:{unexpected:true}}}},'SELECT id FROM house',[],'joined'),undefined);
});
