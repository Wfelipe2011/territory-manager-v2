// Diagnose the built API in an internal, temporary process; no writes to houses.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const url=new URL(process.env.DATABASE_URL);
if(url.hostname!=='db'||url.pathname!=='/territory_manager_load')throw Error('Synthetic base database only');
const fixture=JSON.parse(fs.readFileSync('/load/.runtime/fixture.json'));const b=fixture.blocks[0];
const child=spawn(process.execPath,['dist/main'],{env:{...process.env,PORT:'3002',FIELD_PERF_DIAGNOSTICS:'1'},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
const stop=setTimeout(()=>child.kill('SIGTERM'),55000);
(async()=>{
 let ready=false;
 for(let i=0;i<120;i++){try{const r=await fetch('http://127.0.0.1:3002/api',{signal:AbortSignal.timeout(1000)});await r.arrayBuffer();if(r.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 if(!ready)throw Error('Diagnostic process did not start');
 for(let i=0;i<15;i++){
  const r=await fetch(`http://127.0.0.1:3002/v1/field/blocks/${b.blockId}/sync?clientId=profile-client000000&tabId=profile-tab-id000000`,{headers:{Authorization:'Bearer '+b.token},signal:AbortSignal.timeout(35000)});
  await r.arrayBuffer();if(r.status!==200)throw Error('Diagnostic HTTP '+r.status);
 }
 const entries=log.split('\n').flatMap(line=>{const match=line.match(/\{"event":"field_(?:sync|snapshot)".*?\}/);return match?[JSON.parse(match[0])]:[]});
 if(entries.length<15)throw Error('Missing diagnostic events');
 console.log(JSON.stringify({diagnostics:entries},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>{clearTimeout(stop);child.kill('SIGTERM');});
