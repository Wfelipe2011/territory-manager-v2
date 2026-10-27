const { AsyncLocalStorage } = require('node:async_hooks');
// Increment when changing the raw catalog representation, independently of DB revisions.
const FORMAT_VERSION = 2;
function install(db, snapshot, SQL) {
  const contexts = new AsyncLocalStorage(), backgrounds = new AsyncLocalStorage(), transaction = db.$transaction.bind(db);
  const counts = { hits:0,misses:0,stored:0,storeFailures:0,background:0,backgroundFailures:0,backgroundSkipped:0,evictedScopes:0,pruned:0,pruneFailures:0 };
  const watched = new Map(), pending = new Map();
  const maxScopes = 512, idleMs = 10*60*1000;
  let field, closed=false,lastPrune=0;
  const warn=(kind,count)=>{if(count===1||count%100===0)console.warn(`Field read model ${kind} failures: ${count}`);};
  db.$transaction=async(work,options)=>{
    if(typeof work!=='function')return transaction(work,options);
    const writes=[];
    const value=await contexts.run(writes,()=>transaction(work,options));
    for(const row of writes){
      try{await db.$storeReadModel(row);counts.stored++;}
      catch{counts.storeFailures++;warn('store',counts.storeFailures);}
    }
    return value;
  };
  async function read(connection,user,scope,info){
    const revisions=await connection.query('SELECT round_number,revision::text FROM field_revision WHERE tenant_id=$1 AND territory_id=$2 AND block_id=$3 AND round_number IN (0,$4)',[user.tenantId,user.territoryId,scope.blockId,scope.round??0]);
    const version=JSON.stringify([FORMAT_VERSION,revisions.rows.find(r=>r.round_number===0)?.revision??'0',revisions.rows.find(r=>r.round_number===(scope.round??0))?.revision??'0',info?.status??null,info?.closedAt??null]);
    const key=[user.tenantId,user.territoryId,scope.blockId,scope.round??-1,version],watchKey=JSON.stringify(key.slice(0,4));
    if(!backgrounds.getStore()){
      const principal={tenantId:user.tenantId,territoryId:user.territoryId,blockId:user.blockId,round:user.round??null,roles:[...user.roles]};
      watched.delete(watchKey);watched.set(watchKey,{user:principal,scope:structuredClone(scope),touched:Date.now()});
      if(watched.size>maxScopes){watched.delete(watched.keys().next().value);counts.evictedScopes++;}
    }
    const cached=await connection.query('SELECT payload FROM field_read_model WHERE tenant_id=$1 AND territory_id=$2 AND block_id=$3 AND round_number=$4 AND revision=$5',key);
    let payload=cached.rows[0]?.payload;
    if(payload)counts.hits++;
    else{
      counts.misses++;
      payload=(await connection.query(SQL,[user.tenantId,user.territoryId,scope.blockId,scope.round??-1,info?.status==='closed',user.round==null?0:+user.round])).rows[0].payload;
      const saved=structuredClone(payload);
      if(saved.block)saved.block._signature=null;
      contexts.getStore()?.push([...key,JSON.stringify(saved)]);
    }
    payload=structuredClone(payload);
    if(payload.block){
      const signature=await connection.query(`SELECT s.key,s.expiration_date AS "expirationDate",s.token FROM territory_block l JOIN block_signature bs ON bs.territory_block_id=l.id AND bs.tenant_id=l.tenant_id AND bs.round_number=$4 JOIN signature s ON s.id=bs.signature_id WHERE l.tenant_id=$1 AND l.territory_id=$2 AND l.block_id=$3 AND l.registration_status<>'rejected' LIMIT 1`,[...key.slice(0,3),user.round==null?0:+user.round]);
      payload.block._signature=signature.rows[0]??null;
    }
    return snapshot({query:async()=>({rows:[{payload}]})},user,scope,info);
  }
  function refresh(changed){
    if(!field||closed)return;
    for(const [key,request]of watched){
      const {user,scope,touched}=request;
      if(Date.now()-touched>idleMs){watched.delete(key);counts.evictedScopes++;continue;}
      if(changed&&(user.tenantId!==changed[0]||user.territoryId!==changed[1]||scope.blockId!==changed[2]))continue;
      if(pending.has(key)){pending.get(key).dirty=true;continue;}
      if(pending.size>=maxScopes){counts.backgroundSkipped++;continue;}
      const state={dirty:true};pending.set(key,state);
      (async()=>{
        while(state.dirty&&!closed){
          state.dirty=false;counts.background++;
          await backgrounds.run(true,()=>db.$transaction(async tx=>{
            const info=await field.rounds.resolve(user.tenantId,user.territoryId,user.round,tx);
            return tx.$blockSnapshot(user,{...scope,round:info?.roundNumber??null},info);
          },{isolationLevel:'RepeatableRead'}));
        }
      })().catch(()=>{counts.backgroundFailures++;warn('background',counts.backgroundFailures);}).finally(()=>pending.delete(key));
    }
  }
  async function prune(){
    for(const [key,value]of watched)if(Date.now()-value.touched>idleMs){watched.delete(key);counts.evictedScopes++;}
    if(closed||Date.now()-lastPrune<60000)return;
    lastPrune=Date.now();
    try{const result=await db.$pruneReadModels();counts.pruned+=result.rowCount;}
    catch{counts.pruneFailures++;warn('prune',counts.pruneFailures);}
  }
  return {read,attach(value){field=value;},refresh,prune,close(){closed=true;},stats:()=>({...counts,watched:watched.size,pending:pending.size,maxScopes,formatVersion:FORMAT_VERSION})};
}
module.exports={install,FORMAT_VERSION};
