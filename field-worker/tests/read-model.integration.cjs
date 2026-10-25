// Schema/concurrency checks run only before load, inside the synthetic laboratory.
const assert=require('node:assert/strict');
const {Pool}=require('pg');
(async()=>{
  const url=new URL(process.env.DATABASE_URL);
  if(url.hostname!=='db'||url.username!=='load'||url.pathname!=='/territory_manager_peak_load')throw Error('Synthetic DB required');
  url.search='';const db=new Pool({connectionString:url.toString(),max:2});
  const tenant=1900000001,territory=1900000002,block=1900000003;
  const key=[tenant,territory,block,8],checks=[];
  const store=(revision,payload)=>db.query('SELECT field_store_read_model($1,$2,$3,$4,$5,$6::jsonb)',[...key,revision,JSON.stringify(payload)]);
  const health=async()=>await(await fetch('http://localhost:3402/healthz')).json();
  const until=async(predicate)=>{
    for(let i=0;i<60;i++){const value=await health();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,100));}
    throw Error('Listener did not recover/observe committed notification within six seconds');
  };
  try{
    for(const version of ['v1','v2','v3'])await store(version,{version});
    assert.equal((await db.query('SELECT count(*)::int AS n FROM field_read_model WHERE tenant_id=$1',[tenant])).rows[0].n,2);
    checks.push('at most two recent versions per scope');
    await Promise.all(Array.from({length:8},()=>store('v4',{version:'immutable'})));
    await store('v4',{version:'must-not-overwrite'});
    assert.equal((await db.query('SELECT payload FROM field_read_model WHERE tenant_id=$1 AND revision=$2',[tenant,'v4'])).rows[0].payload.version,'immutable');
    checks.push('concurrent idempotent writers preserve immutable payload');
    await db.query('UPDATE field_read_model SET updated_at=now()-interval \'2 hours\' WHERE tenant_id=$1',[tenant]);
    const deleted=await db.query("DELETE FROM field_read_model WHERE ctid IN (SELECT ctid FROM field_read_model WHERE updated_at<now()-interval '1 hour' ORDER BY updated_at LIMIT 1000)");
    assert(deleted.rowCount>=1);
    checks.push('bounded expiry cleanup removes old derived rows');
    const before=await until(value=>value.listenerConnected);
    const killed=await db.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND application_name='field-revision-listener'");
    assert.equal(killed.rowCount,1);
    await until(value=>value.listenerConnected&&value.stats.notifications.connections>before.stats.notifications.connections);
    checks.push('dedicated listener reconnects after backend termination');
    const count=(await health()).stats.notifications.notifications;
    const client=await db.connect();
    try{
      await client.query('BEGIN');
      await client.query('INSERT INTO field_revision(tenant_id,territory_id,block_id,round_number) VALUES($1,$2,$3,$4)',key);
      await client.query('ROLLBACK');
    }finally{client.release();}
    assert.equal((await health()).stats.notifications.notifications,count);
    checks.push('rolled-back revision does not emit a committed notification');
    await db.query('INSERT INTO field_revision(tenant_id,territory_id,block_id,round_number) VALUES($1,$2,$3,$4)',key);
    await until(value=>value.stats.notifications.notifications>count);
    checks.push('committed revision reaches the recovered listener');
    console.log(JSON.stringify({passed:checks.length,checks}));
  }finally{await db.query('DELETE FROM field_read_model WHERE tenant_id=$1',[tenant]);await db.query('DELETE FROM field_revision WHERE tenant_id=$1',[tenant]);await db.end();}
})().catch(error=>{console.error(error);process.exitCode=1;});
