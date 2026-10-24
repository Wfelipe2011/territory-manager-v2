// Only synthetic data; this script refuses every other database.
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const jwt = require('/app/node_modules/jsonwebtoken');
const fs = require('fs');
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== 'db' || url.pathname !== '/territory_manager_load' || process.env.JWT_SECRET !== 'load-test-isolated-secret') throw Error('Only isolated load database allowed');
  const db = new PrismaClient();
  try {
    if (await db.multitenancy.count()) throw Error('Load database is already seeded');
    await db.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
    // Bulk fixture creation is one transaction; all application triggers remain enabled.
    await db.$executeRawUnsafe(`INSERT INTO multi_tenancy(id,name,city,state) SELECT i,'QA Carga '||i,'Sorocaba','SP' FROM generate_series(1,10) i`);
    await db.$executeRawUnsafe(`INSERT INTO type(id,name,tenant_id) SELECT i,'Residencial',i FROM generate_series(1,10) i`);
    await db.$executeRawUnsafe(`INSERT INTO territory(id,name,tenant_id,type_id) SELECT i,'Território '||i,1+(i-1)/5,1+(i-1)/5 FROM generate_series(1,50) i`);
    await db.$executeRawUnsafe(`INSERT INTO block(id,name,tenant_id) SELECT i,'Quadra '||i,1+(i-1)/40 FROM generate_series(1,400) i`);
    await db.$executeRawUnsafe(`INSERT INTO territory_block(id,tenant_id,territory_id,block_id) SELECT i,1+(i-1)/40,1+(i-1)/8,i FROM generate_series(1,400) i`);
    await db.$executeRawUnsafe(`INSERT INTO address(id,name,tenant_id) SELECT i,'Rua '||i,1+(i-1)/120 FROM generate_series(1,1200) i`);
    await db.$executeRawUnsafe(`INSERT INTO territory_block_address(id,tenant_id,territory_block_id,address_id) SELECT i,1+(i-1)/120,1+(i-1)/3,i FROM generate_series(1,1200) i`);
    await db.$executeRawUnsafe(`INSERT INTO round_info(tenant_id,round_number,name,theme,type_ids,status,type,color_primary,color_secondary) SELECT t,r,'Rodada '||r,'default',ARRAY[t],CASE WHEN r=8 THEN 'open'::"RoundStatus" ELSE 'closed'::"RoundStatus" END,'Residencial','#7AAD58','#CBE6BA' FROM generate_series(1,10) t CROSS JOIN generate_series(1,8) r`);
    await db.$executeRawUnsafe(`INSERT INTO house(id,number,tenant_id,territory_id,block_id,address_id,territory_block_address_id,legend) SELECT i,(((i-1)%50)+1)::text,1+(i-1)/6000,1+(i-1)/1200,1+(i-1)/150,1+(i-1)/50,1+(i-1)/50,'Residência' FROM generate_series(1,60000) i`);
    await db.$executeRawUnsafe(`INSERT INTO round(house_id,tenant_id,territory_id,block_id,round_number,completed,mode,end_date) SELECT h.id,h.tenant_id,h.territory_id,h.block_id,r,false,'default',CASE WHEN r<8 THEN '2026-01-01'::timestamp END FROM house h CROSS JOIN generate_series(1,8) r`);
    const fixture = { name: 'territory-load-v1', houses: 60000, rounds: 480000, blocks: [] };
    for (let b=1;b<=400;b++) {
      const tenantId=1+Math.floor((b-1)/40), territoryId=1+Math.floor((b-1)/8);
      const code='L'+b.toString(36).toUpperCase().padStart(5,'0');
      const token=jwt.sign({ id:code,tenantId,territoryId,blockId:b,round:8,roles:['publisher'],overseer:'QA Carga' },process.env.JWT_SECRET,{expiresIn:'7d'});
      await db.signature.create({data:{key:code,token,tenantId,expirationDate:new Date(Date.now()+7*86400000)}});
      fixture.blocks.push({blockId:b,territoryId,tenantId,code,token,firstHouse:(b-1)*150+1,firstAddress:(b-1)*3+1});
    }
    for (const table of ['multi_tenancy','type','territory','block','address','territory_block','territory_block_address','house']) await db.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"${table}"','id'), (SELECT max(id) FROM "${table}"))`);
    await db.$executeRawUnsafe('ANALYZE');
    fs.writeFileSync('/output/fixture.json',JSON.stringify(fixture),{mode:0o600});
    console.log(JSON.stringify({houses:fixture.houses,rounds:fixture.rounds,blocks:fixture.blocks.length}));
  } finally { await db.$disconnect(); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
