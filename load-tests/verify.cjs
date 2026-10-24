const fs=require('fs');
const fixture=JSON.parse(fs.readFileSync(process.env.DATABASE_URL?.includes('/territory_manager_peak_load')?'/load/.runtime/fixture-peak.json':'/load/.runtime/fixture.json'));
if(!['territory-load-v1','territory-load-peak-v1'].includes(fixture.name))throw Error('Fixture inválida');
const b=fixture.blocks[0];
const identity='load-verification000000000';
const headers={'Content-Type':'application/json',Authorization:`Bearer ${b.token}`};
const url=(api,cursor)=>`http://${api}:3000/v1/field/blocks/${b.blockId}/sync?clientId=${identity}&tabId=${identity}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`;
async function state(api,cursor) {
 const response=await fetch(url(api,cursor),{headers,signal:AbortSignal.timeout(35000)});
 if(response.status!==200)throw Error(`Snapshot: ${response.status}`);
 return response.json();
}
const house=s=>s.data?.streets.flatMap(s=>s.houses).find(h=>h.id===b.firstHouse);
async function main(){
 for(const [reader,writer] of [['api1','api2'],['api2','api1']]){
  const first=await state(reader), prior=house(first);
  let pending=state(reader,first.cursor);
  const write=await fetch(`http://${writer}:3000/v1/territories/${b.territoryId}/blocks/${b.blockId}/address/${b.firstAddress}/houses/${b.firstHouse}`,{method:'PATCH',headers,body:JSON.stringify({round:8,status:!prior.status})});
  if(write.status!==200)throw Error(`Marcação: ${write.status}`);
  const ack=Date.now(),deadline=ack+35000;
  let observed=false;
  while(Date.now()<deadline){
   const next=await pending;
   if(house(next)?.status===!prior.status){observed=true;break;}
   pending=state(reader,next.cursor);
  }
  if(!observed)throw Error('Estado não propagado');
  console.log(JSON.stringify({reader,writer,propagation_ms:Date.now()-ack}));
 }
 const upstreams=new Set();
 for(let i=0;i<6;i++){
  const response=await fetch(`http://proxy:8080/v1/field/blocks/${b.blockId}/sync?clientId=${identity}&tabId=${identity}`,{headers});
  if(response.status!==200)throw Error('Balanceador indisponível');
  upstreams.add(response.headers.get('x-load-upstream'));await response.arrayBuffer();
 }
 if(upstreams.size!==2)throw Error('As duas APIs não receberam tráfego');
 console.log(JSON.stringify({balanced_instances:upstreams.size}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
