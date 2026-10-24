import http from 'k6/http';
import { sleep } from 'k6';
import exec from 'k6/execution';
import { Trend, Counter } from 'k6/metrics';
import { config, blockFor } from './config.js';
import { errors, propagation, probes, missed, observe, pollUrl, params, snapshot, mark } from './api.js';
const htmlTime = new Trend('page_ms',true);
const pageBytes = new Trend('page_bytes');
const assetBytes = new Counter('asset_bytes');
const users=config.USERS;
const idle=__ENV.WORKLOAD==='idle';
export const options = {
  discardResponseBodies: true,
  systemTags: ['status','method','name','scenario','expected_response'],
  scenarios: {
    observers: { executor:'constant-vus',vus:users,duration:config.DURATION,exec:'observeScreen',gracefulStop:'35s' },
    ...(!idle ? { writers: { executor:'constant-arrival-rate',rate:Math.max(1,Math.round(users*0.2)),timeUnit:'10s',duration:config.DURATION,preAllocatedVUs:Math.max(2,Math.ceil(users*0.04)),maxVUs:Math.max(4,Math.ceil(users*0.2)),exec:'writeHouse',gracefulStop:'35s' } } : {}),
    pages: { executor:'constant-arrival-rate',rate:users,timeUnit:'60s',duration:config.DURATION,preAllocatedVUs:2,maxVUs:20,exec:'openPage',gracefulStop:'35s' },
    ...(!idle ? { propagation: { executor:'constant-vus',vus:1,duration:config.DURATION,exec:'probePropagation',gracefulStop:'35s' } } : {}),
    ...(!idle && parseInt(config.DURATION)>=90 ? { burst: { executor:'constant-arrival-rate',rate:Math.max(1,Math.round(users*0.2)),timeUnit:'1s',duration:'5s',startTime:'60s',preAllocatedVUs:Math.max(2,Math.ceil(users*0.2)),maxVUs:Math.max(4,Math.ceil(users*0.4)),exec:'writeHouse',gracefulStop:'35s' } } : {}),
  },
  thresholds: {
    snapshot_ms:['p(95)<=1000'],...(!idle ? {mark_ms:['p(95)<=500'],propagation_missing:['count==0']} : {}),unexpected_errors:['rate<0.01'],
    dropped_iterations:['count==0'],
  },
  summaryTrendStats:['avg','min','med','max','p(90)','p(95)','p(99)'],
};
let cursor;
const nonce=String(__VU).padStart(12,'0');
export function observeScreen() {
  const block=blockFor(__VU-1);
  // Reconnection of 10% of screens once per minute without overlapping their poll.
  if (Math.floor(exec.instance.currentTestRunDuration/60000)>0 && __VU%10===0 && __ITER%4===0) cursor=undefined;
  if (!cursor) { const res=snapshot(block,nonce); cursor=res?.cursor; if(!cursor)sleep(1); return; }
  const res=observe(http.get(pollUrl(block,nonce,cursor),params(block,'poll')));
  if(res.status===200) { try { cursor=res.json().cursor; } catch { errors.add(true); } } else sleep(1);
}
export function writeHouse() {
  const i=exec.scenario.iterationInTest+(exec.scenario.name==='burst'?100000:0);
  const block=blockFor(i);
  const activeBlocks=config.PROFILE==='hotspot'?1:Math.min(users,400);
  // Reserve offset zero for the propagation probe; repeatable rotation across houses.
  const offset=1+(Math.floor(i/activeBlocks)%149);
  mark(block,offset,Math.floor(i/(activeBlocks*149))%2===0);
}
export function openPage() {
  const block=blockFor(exec.scenario.iterationInTest);
  const res=http.get(`${config.ADMIN_URL}/campo/${block.code}`,{tags:{name:'field_page'},responseType:'text',timeout:'10s'});
  errors.add(res.status!==200);htmlTime.add(res.timings.duration);pageBytes.add(res.body?.length||0);
  // Cold browser: 20% of arrivals. Warm browser reuses immutable assets.
  if(exec.scenario.iterationInTest%5===0 && res.body) {
    const assets=[...new Set((res.body.match(/(?:src|href)="([^" ]+\.(?:js|css)(?:\?[^" ]*)?)"/g)||[]).map(v=>v.slice(v.indexOf('"')+1,-1)).filter(v=>v.startsWith('/_next/')))];
    const responses=http.batch(assets.map(path=>['GET',`${config.ADMIN_URL}${path}`,null,{tags:{name:'static_asset'}}]));
    for(const asset of responses) { errors.add(asset.status!==200);assetBytes.add(Number(asset.headers['Content-Length']||0)); }
  }
}
export async function probePropagation() {
  missed.add(0);probes.add(0);
  const block=blockFor(0), id='probe000000000000', first=snapshot(block,id);
  if(!first?.data) {sleep(1);return;}
  const initialHouse=first.data.streets.flatMap(s=>s.houses).find(h=>h.id===block.firstHouse);
  const target=!initialHouse.status;
  let responsePromise=http.asyncRequest('GET',pollUrl(block,id,first.cursor),null,params(block,'probe_poll'));
  sleep(0.2);
  if(mark(block,0,target).status!==200) {await responsePromise;return;}
  const acknowledged=Date.now();
  const deadline=acknowledged+35000;
  let nextCursor=first.cursor,seen=false;
  while(Date.now()<deadline) {
    const res=observe(await responsePromise);
    if(res.status!==200)break;
    const state=res.json();nextCursor=state.cursor;
    const updated=state.data?.streets.flatMap(s=>s.houses).find(h=>h.id===block.firstHouse);
    if(updated && updated.status===target && updated.completedDate!==initialHouse.completedDate) { propagation.add(Math.max(0,Date.now()-acknowledged));probes.add(1);seen=true;break; }
    responsePromise=http.asyncRequest('GET',pollUrl(block,id,nextCursor),null,params(block,'probe_poll'));
  }
  if(!seen)missed.add(1);
  sleep(1);
}
export function handleSummary(data) { return { '/output/summary.json': JSON.stringify(data,null,2) }; }
