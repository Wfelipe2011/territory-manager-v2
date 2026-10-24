import http from 'k6/http';
import exec from 'k6/execution';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { config, blockFor } from './config.js';
import { errors, observe, pollUrl, params, snapshot, mark } from './api.js';
const users=config.USERS, active=users/10, idle=__ENV.WORKLOAD==='idle';
if(users<10 || users%10!==0) throw Error('Use multiples of ten users');
const changedTime=new Trend('changed_poll_ms',true), unchangedTime=new Trend('unchanged_poll_ms',true);
const initialCount=new Counter('initial_snapshots'), changedCount=new Counter('changed_snapshots'), unchangedCount=new Counter('unchanged_polls');
export const options={discardResponseBodies:true,systemTags:['status','method','name','scenario','expected_response'],
  scenarios:{observers:{executor:'constant-vus',vus:users,duration:config.DURATION,exec:'observeScreen',gracefulStop:'35s'},
    ...(!idle?{writers:{executor:'constant-arrival-rate',rate:active,timeUnit:'30s',duration:config.DURATION,preAllocatedVUs:Math.max(2,Math.ceil(active/5)),maxVUs:Math.max(4,active),exec:'writeHouse',gracefulStop:'35s'}}:{})},
  thresholds:{snapshot_ms:['p(95)<=1000'],initial_snapshots:[`count>=${users}`],...(!idle?{mark_ms:['p(95)<=500']} : {}),unexpected_errors:['rate<0.01'],dropped_iterations:['count==0']},
  summaryTrendStats:['avg','min','med','max','p(90)','p(95)','p(99)']};
let cursor,previous;
const logical=(__VU-1)%users, cohort=Math.floor(logical/10), nonce=String(__VU).padStart(12,'0');
const sampled=logical%10===1 && (config.PROFILE!=='hotspot'||cohort<20);
function remember(state,initial){
  if(!sampled||!state.data)return;
  if(initial)console.log('FIELD_EVENT '+JSON.stringify({event:'initial',at:Date.now(),observer:logical,states:state.data.streets.flatMap(s=>s.houses.map(h=>[h.id,h.status]))}));
  const next={};
  for(const street of state.data.streets)for(const h of street.houses){next[h.id]=h.status;
    if(!initial&&previous&&previous[h.id]!==undefined&&previous[h.id]!==h.status)
      console.log('FIELD_EVENT '+JSON.stringify({event:'seen',house:h.id,status:h.status,at:Date.now(),observer:logical}));}
  previous=next;
}
export function observeScreen(){
  const block=blockFor(logical);
  if(!cursor){const state=snapshot(block,nonce);cursor=state?.cursor;if(state){initialCount.add(1);remember(state,true);}else sleep(1);return;}
  const res=observe(http.get(pollUrl(block,nonce,cursor),params(block,'poll')));
  if(res.status!==200){cursor=undefined;sleep(1);return;}
  try{const state=res.json();cursor=state.cursor;if(state.changed){changedCount.add(1);changedTime.add(res.timings.duration);remember(state,false);}else{unchangedCount.add(1);unchangedTime.add(res.timings.duration);}}
  catch{errors.add(true);cursor=undefined;sleep(1);}
}
export function writeHouse(){
  const i=exec.scenario.iterationInTest;
  if(i>=active*4)return; // Exclude k6 arrival exactly at the 120s boundary.
  const owner=i%active, block=blockFor(owner*10);
  const offset=config.PROFILE==='hotspot'?i%150:Math.floor(i/active)%150;
  const status=config.PROFILE==='hotspot'?Math.floor(i/150)%2===0:Math.floor(i/(active*150))%2===0;
  const started=Date.now(),response=mark(block,offset,status);
  if(response.status===200)console.log('FIELD_EVENT '+JSON.stringify({event:'ack',sequence:i,house:block.firstHouse+offset,status,started,at:Date.now(),owner:owner*10}));
}
export function handleSummary(data){return {'/output/summary.json':JSON.stringify(data,null,2)};}
