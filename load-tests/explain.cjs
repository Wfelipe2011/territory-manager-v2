/* Read-only SQL diagnosis; deliberately refuses every non-synthetic database. */
const { PrismaClient }=require('/app/node_modules/@prisma/client');
const url=new URL(process.env.DATABASE_URL);
if(url.hostname!=='db'||url.pathname!=='/territory_manager_load')throw Error('Synthetic load database only');
const db=new PrismaClient({log:[{emit:'event',level:'query'}]});
let captured=[],capture=false;
db.$on('query',e=>{if(capture&&e.query.startsWith('SELECT'))captured.push({sql:e.query,params:JSON.parse(e.params)});});
(async()=>{const result=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout='15s'");
  const scope={tenantId:1,territoryId:1,blockId:1};
  const mappings=await tx.territory_block_address.findMany({where:{tenantId:scope.tenantId,registrationStatus:{not:'rejected'},territoryBlock:{...scope,blockId:scope.blockId,registrationStatus:{not:'rejected'}}},select:{id:true}});
  const indexes=await tx.$queryRawUnsafe("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('house','round','territory_block','territory_block_address','field_revision','field_session') ORDER BY tablename,indexname");
  const variants=[],ids=[];
  for(const [name,OR]of [['original',[{territoryBlockAddressId:null},{territoryBlockAddress:{registrationStatus:{not:'rejected'}}}]],['scoped_mappings',[{territoryBlockAddressId:null},{territoryBlockAddressId:{in:mappings.map(m=>m.id)}}]]]){
    captured=[];capture=true;
    const houses=await tx.house.findMany({where:{tenantId:1,territoryId:1,blockId:{in:[1]},registrationStatus:{not:'rejected'},number:{not:'ghost'},OR},select:{id:true,number:true,legend:true,dontVisit:true,complement:true,order:true,addressId:true,blockId:true,registrationStatus:true,territoryBlockAddressId:true,address:{select:{name:true}},rounds:{where:{roundNumber:8},take:1,select:{completed:true,completedDate:true,endDate:true,leaveLetter:true}}}});
    capture=false;ids.push(houses.map(h=>h.id).sort((a,b)=>a-b));
    const queries=[];
    for(const q of captured){const sql=q.sql.replace(/\$(\d+)\b/g,(p,n)=>q.params[Number(n)-1]==='rejected'?p+'::"RegistrationStatus"':p);const plans=[];
      for(let i=0;i<5;i++){const explain=await tx.$queryRawUnsafe('EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) '+sql,...q.params);plans.push(explain[0]['QUERY PLAN'][0]);}
      queries.push({...q,plans});}
    variants.push({name,houses:houses.length,queries});
  }
  if(JSON.stringify(ids[0])!==JSON.stringify(ids[1]))throw Error('Query variants returned different houses');
  return {database:'territory_manager_load',scope,identical_house_ids:true,indexes,variants};
},{timeout:60000});console.log(JSON.stringify(result,null,2));})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect());
