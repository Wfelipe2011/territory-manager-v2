const assert=require('node:assert/strict'),{Pool}=require('../experiments/native-pool.cjs');
(async()=>{
  const url=new URL(process.env.DATABASE_URL);
  if(url.hostname!=='db'||url.username!=='load'||url.pathname!=='/territory_manager_peak_load')throw Error('Synthetic DB required');
  url.search='';const pool=new Pool({connectionString:url.toString(),max:2,connectionTimeoutMillis:2000}),checks=[];
  try{
    const data=(await pool.query(`SELECT 9223372036854775807::bigint AS big,1.25::numeric AS decimal,'2026-01-02 03:04:05'::timestamp AS utc,'2026-01-02 03:04:05+00'::timestamptz AS tz, $1::jsonb AS payload`,[JSON.stringify({safe:true})])).rows[0];
    assert.equal(data.big,'9223372036854775807');assert.equal(data.decimal,'1.25');
    assert.equal(data.utc.toISOString(),'2026-01-02T03:04:05.000Z');assert.equal(data.tz.toISOString(),data.utc.toISOString());assert.deepEqual(data.payload,{safe:true});
    checks.push('bigint numeric timestamps and JSON parity');
    assert.deepEqual((await pool.query('SELECT ARRAY[1,2]::integer[] AS ids')).rows[0].ids,[1,2]);
    checks.push('PostgreSQL integer arrays remain JSON arrays');
    const client=await pool.connect();
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      assert.equal((await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation,'repeatable read');
      await client.query('CREATE TEMP TABLE native_candidate_probe(value integer) ON COMMIT DROP');
      await client.query('INSERT INTO native_candidate_probe VALUES(1)');
      await client.query('ROLLBACK');
    }finally{client.release();}
    assert.equal((await pool.query("SELECT to_regclass('pg_temp.native_candidate_probe') AS probe")).rows[0].probe,null);
    checks.push('reserved connection isolation and rollback');
    await assert.rejects(()=>pool.query('SELECT 1/0'));
    const result=await Promise.all(Array.from({length:8},()=>pool.query('SELECT 1 AS ok')));
    assert(result.every(r=>r.rows[0].ok===1));assert.equal(pool.active,0);assert.equal(pool.waitingCount,0);
    checks.push('query error releases connection and bounded pool recovers');
    console.log(JSON.stringify({passed:checks.length,checks,bunVersion:Bun.version}));
  }finally{await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
