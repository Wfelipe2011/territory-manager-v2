import assert from 'node:assert/strict';
import { buildReaders, activeOwner } from './distribution.mjs';
const blocks=Array.from({length:400},(_,i)=>({tenantId:(i%50)%12+1}));
for(const users of [150,300,1000])for(const group of [10,20]){
 const readers=buildReaders(blocks,users,group),counts=new Map(),tenants=new Set();
 for(const reader of readers){counts.set(reader.blockIndex,(counts.get(reader.blockIndex)||0)+1);tenants.add(blocks[reader.blockIndex].tenantId);}
 assert.equal(tenants.size,12);assert.equal(readers.filter(r=>r.active).length,users/10);
 assert(Math.min(...counts.values())>=10);assert(Math.max(...counts.values())<=20);
 for(let i=0;i<users/10;i++)assert(readers[activeOwner(i,12)].active);
 for(const b of counts.keys())assert(readers.some(r=>r.blockIndex===b&&r.sampled&&!r.active));
 // Each writer uses four different houses; writers sharing a block do not collide.
 const selected=new Set();
 for(let i=0;i<users/10;i++)for(let round=0;round<4;round++){
  const key=readers[activeOwner(i,12)].blockIndex+':'+(Math.floor(i/12)*4+round);
  assert(!selected.has(key));selected.add(key);
 }
}
const stress=buildReaders(blocks,1000,10,true);
assert.equal(new Set(stress.map(r=>r.blockIndex)).size,1);assert.equal(stress.filter(r=>r.sampled).length,20);
console.log('Peak distribution: twelve tenants, 10–20 per block, independent writers and sampled peers verified');
