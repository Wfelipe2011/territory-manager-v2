// Run in the selected Bun image, outside any capacity run. Input fixture stays private.
require('reflect-metadata');
const fs=require('node:fs');
const {Client,Pool}=require('pg');
const {Prisma}=require('@prisma/client');
const jwt=require('jsonwebtoken');
const {assertSynthetic,classes}=require('../shared/core.cjs');
const createAdapter=require('./pg-adapter.cjs');
assertSynthetic();
const block=JSON.parse(fs.readFileSync(0,'utf8'));
const user=jwt.decode(block.token);
const captures=[];
const query=Client.prototype.query;
Client.prototype.query=function(text,values,...rest){
 const sql=typeof text==='string'?text:text.text,parameters=typeof text==='string'?values:text.values;
 if(/^SELECT|^WITH/.test(sql) && /FROM (?:(?:"public"\.)?"?house"?|territory_block)\b/i.test(sql)) captures.push({sql,parameters});
 return query.call(this,text,values,...rest);
};
(async()=>{
 const c=classes(),db=createAdapter(process.env.DATABASE_URL,Prisma.dmmf.datamodel.models);
 const rounds=new c.CatalogRoundService(db),access=new c.FieldAccessService(db,rounds),field=new c.FieldService(db,access,rounds);
 const data=await db.$transaction(async tx=>{
  const info=await rounds.resolve(user.tenantId,user.territoryId,user.round,tx);
  const scope={blockId:block.blockId,round:info.roundNumber,hours:5,fullBlock:true,canEditStructure:false,scope:'block'};
  if(process.env.LAB_SNAPSHOT_MODE==='aggregate') return tx.$blockSnapshot(user,scope,info);
  return field.snapshot(tx,user,scope,info);
 },{isolationLevel:'RepeatableRead'});
 const plans=[];
 // Client.query spy is observational; explain only SELECTs with numeric snapshot parameters.
 const pool=new Pool({connectionString:process.env.DATABASE_URL.split('?')[0],max:1});
 const conn=await pool.connect();
 try {
  await conn.query('BEGIN READ ONLY');
  for(const item of captures.slice()) {
   if(item.parameters?.some(v=>typeof v==='string'&&!/^[-0-9]+$/.test(v)&&!['rejected','ghost'].includes(v))) continue;
   const samples=[];
   for(let i=0;i<5;i++) samples.push((await query.call(conn,'EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) '+item.sql,item.parameters)).rows[0]['QUERY PLAN'][0]);
   plans.push({sql:item.sql,samples});
  }
  await conn.query('ROLLBACK');
 } finally {conn.release();await pool.end();await db.$disconnect();}
 console.log(JSON.stringify({mode:process.env.LAB_SNAPSHOT_MODE||'baseline',houses:data.streets.reduce((n,s)=>n+s.houses.length,0),plans},null,2));
})().catch(e=>{console.error(e.message);process.exit(1);});
