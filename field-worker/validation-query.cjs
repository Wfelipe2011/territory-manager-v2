// Fresh database reads may be shared only while in flight for the same grant.
// Original JWT verification and claim checks still execute for EVERY caller.
const {AsyncLocalStorage}=require('node:async_hooks');
const {create}=require('./inflight.cjs');
module.exports=function validationQuery(){
  const contexts=new AsyncLocalStorage(), reads=create();
 const stats={invocations:0,statements:0,territoryReuses:0,linkReuses:0};
 const SQL=`SELECT s.id,s.key,s.token,s.tenant_id AS "tenantId",s.can_edit_structure AS "canEditStructure",s.expiration_date AS "expirationDate",
 CASE WHEN t.id IS NULL THEN NULL ELSE json_build_object('id',t.id,'name',t.name,'tenantId',t.tenant_id,'typeId',t.type_id,'imageUrl',t.image_url) END AS _territory,
 CASE WHEN b.id IS NULL THEN NULL ELSE json_build_object('id',b.id,'registrationStatus',b.registration_status,'blockId',b.block_id,'territoryId',b.territory_id,'signatureId',b.signature_id,'tenantId',b.tenant_id) END AS _link
 FROM signature s LEFT JOIN territory t ON t.id=$4 AND t.tenant_id=$2
 LEFT JOIN territory_block b ON b.territory_id=$4 AND b.block_id=$5 AND b.tenant_id=$2 AND b.registration_status<>'rejected'
 WHERE s.key=$1 AND s.tenant_id=$2 AND s.expiration_date>$3 LIMIT 1`;
 async function load(connection,name,args){
  const context=contexts.getStore(); if(!context)return;
  const {user}=context,where=args.where||{};
  if(name==='signature' && Object.keys(where).length===3 && where.key===user.id && where.tenantId===user.tenantId && where.expirationDate?.gt instanceof Date && !args.select && !args.include){
    const key=JSON.stringify([user.tenantId,user.id,user.territoryId,user.blockId??null,user.round??null,user.roles]);
    context.value=await reads.run(key,async()=>{
      stats.statements++;
      return (await connection.query(SQL,[user.id,user.tenantId,where.expirationDate.gt.toISOString(),user.territoryId,user.blockId||null])).rows[0]??null;
    });
    context.loaded=true;
    if(context.value && new Date(context.value.expirationDate).getTime()<=Date.now())context.value=null;
   if(!context.value)return [];
   const {_territory,_link,...signature}=context.value;return[signature];
  }
  if(!context.loaded||!context.value)return;
  if(name==='territory' && Object.keys(where).length===2 && where.id===user.territoryId && where.tenantId===user.tenantId && !args.select && !args.include)
   {stats.territoryReuses++;return context.value._territory?[context.value._territory]:[];}
  if(name==='territory_block' && Object.keys(where).length===4 && where.tenantId===user.tenantId && where.territoryId===user.territoryId && where.blockId===user.blockId && where.registrationStatus?.not==='rejected' && !args.select && !args.include)
   {stats.linkReuses++;return context.value._link?[context.value._link]:[];}
 }
  return {run:(user,fn)=>{stats.invocations++;return contexts.run({user},fn);},load,stats:()=>({...stats,inflightSharing:true,followers:reads.stats().followers,pending:reads.stats().pending})};
};
