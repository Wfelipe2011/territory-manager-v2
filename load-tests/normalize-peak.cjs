const {PrismaClient}=require('/app/node_modules/@prisma/client');
const fs=require('node:fs');
const url=new URL(process.env.DATABASE_URL);
if(url.hostname!=='db'||url.pathname!=='/territory_manager_peak_load')throw Error('Peak synthetic database only');
const fixture=JSON.parse(fs.readFileSync('/load/.runtime/fixture-peak.json'));
if(fixture.name!=='territory-load-peak-v1'||fixture.tenants!==12||fixture.blocks.length!==400)throw Error('Unexpected fixture');
const values=fixture.blocks.map((b,i)=>{
 if(b.blockId!==i+1||b.code!=='P'+(i+1).toString(36).toUpperCase().padStart(5,'0'))throw Error('Unexpected fixture IDs');
 return `(${b.blockId},'${b.code}')`;
}).join(',');
const db=new PrismaClient();
(async()=>{const affected=await db.$executeRawUnsafe(`UPDATE territory_block AS tb SET signature_id=s.id FROM signature AS s JOIN (VALUES ${values}) AS v(block_id,code) ON s.key=v.code WHERE tb.block_id=v.block_id AND tb.tenant_id=s.tenant_id AND tb.signature_id IS DISTINCT FROM s.id`);
console.log(JSON.stringify({linked_signatures:affected}));})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect());
