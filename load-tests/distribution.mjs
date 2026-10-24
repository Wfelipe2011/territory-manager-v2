export function activeOwner(index, tenants) {
  return Math.floor(index/tenants)*tenants*10+index%tenants;
}
export function buildReaders(blocks, users, preferred=10, hotspot=false) {
  const tenants=[...new Set(blocks.map(b=>b.tenantId))].sort((a,b)=>a-b);
  if(users<tenants.length*10||users%10)throw Error('Peak profile requires at least ten users per tenant and multiples of ten');
  const owners=new Set(Array.from({length:users/10},(_,i)=>activeOwner(i,tenants.length)));
  const byTenant=tenants.map(t=>blocks.flatMap((b,i)=>b.tenantId===t?[i]:[]));
  const samples=new Map();
  return Array.from({length:users},(_,logical)=>{
    const t=logical%tenants.length,ordinal=Math.floor(logical/tenants.length);
    const population=Math.floor((users+tenants.length-1-t)/tenants.length);
    const groups=Math.max(1,preferred===10?Math.floor(population/10):Math.ceil(population/20));
    const group=Math.floor(ordinal*groups/population);
    const blockIndex=hotspot?0:byTenant[t][group];
    if(blockIndex===undefined)throw Error('Insufficient fixture blocks');
    const selected=samples.get(blockIndex)||0,limit=hotspot?20:2;
    const sampled=!owners.has(logical)&&selected<limit;
    if(sampled)samples.set(blockIndex,selected+1);
    return {blockIndex,sampled,active:owners.has(logical)};
  });
}
