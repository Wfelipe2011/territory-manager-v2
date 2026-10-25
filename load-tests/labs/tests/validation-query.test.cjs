const {test}=require('node:test');
const assert=require('node:assert/strict');
const factory=require('../bun/validation-query.cjs');
const args=user=>({where:{key:user.id,tenantId:user.tenantId,expirationDate:{gt:new Date('2026-01-01T10:00:00Z')}}});
const territory=user=>({where:{id:user.territoryId,tenantId:user.tenantId}});
const link=user=>({where:{tenantId:user.tenantId,territoryId:user.territoryId,blockId:user.blockId,registrationStatus:{not:'rejected'}}});
test('invocações paralelas mantêm congregações e escopos isolados',async()=>{
 const adapter=factory(),calls=[];
 const connection={query:async(sql,p)=>{calls.push(p);await new Promise(r=>setTimeout(r,p[1]===1?10:1));return{rows:[{id:p[1],key:p[0],tenantId:p[1],_territory:{id:p[3]},_link:{id:p[4]}}]};}};
 const users=[{id:'a',tenantId:1,territoryId:11,blockId:101},{id:'b',tenantId:2,territoryId:22,blockId:202}];
 await Promise.all(users.map(user=>adapter.run(user,async()=>{
  const [signature]=await adapter.load(connection,'signature',args(user));
  assert.equal(signature.tenantId,user.tenantId);assert(!('_link'in signature));
  assert.equal((await adapter.load(connection,'territory',territory(user)))[0].id,user.territoryId);
  assert.equal((await adapter.load(connection,'territory_block',link(user)))[0].id,user.blockId);
 })));
 assert.equal(calls.length,2);assert.equal(calls[0][2],'2026-01-01T10:00:00.000Z');
 assert.equal(await adapter.load(connection,'territory',territory(users[0])),undefined);
});
test('nova validação consulta revogação sem reutilizar assinatura entre chamadas',async()=>{
 const adapter=factory(),user={id:'a',tenantId:1,territoryId:11,blockId:101};let count=0;
 const connection={query:async()=>({rows:++count===1?[{id:1,tenantId:1,_territory:{id:11},_link:{id:101}}]:[]})};
 const first=await adapter.run(user,()=>adapter.load(connection,'signature',args(user)));
 const second=await adapter.run(user,()=>adapter.load(connection,'signature',args(user)));
 assert.equal(first.length,1);assert.deepEqual(second,[]);assert.equal(count,2);
});
test('filtros desconhecidos permanecem no compilador normal',async()=>{
 const adapter=factory(),user={id:'a',tenantId:1,territoryId:11,blockId:101};
 const connection={query:async()=>{throw Error('must not query');}};
 assert.equal(await adapter.run(user,()=>adapter.load(connection,'signature',{where:{...args(user).where,id:7}})),undefined);
});
