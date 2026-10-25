const variant=process.env.FIELD_CANDIDATE;
if(!['control','copies','roundtrips','native','cpu'].includes(variant))throw Error('Explicit candidate required');
const target=new URL(process.env.DATABASE_URL);
if(target.hostname!=='db'||target.username!=='load'||target.pathname!=='/territory_manager_peak_load')throw Error('Synthetic database required');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{createHash}=require('node:crypto');
const {transform}=require('./candidates.cjs');
const stats={variant,cloneCalls:0,cloneMs:0,serializationCalls:0,serializationMs:0,lagSamples:0,lagTotalMs:0,lagMaxMs:0,poolAcquisitions:0,poolWaitMs:0,poolWaitMaxMs:0};
stats.stages={};
globalThis.__candidateStage=(name,ms)=>{const stage=stats.stages[name]||={calls:0,totalMs:0,maxMs:0};stage.calls++;stage.totalMs+=ms;stage.maxMs=Math.max(stage.maxMs,ms);};
globalThis.__candidateSerialize=value=>{const start=performance.now();try{return JSON.stringify(value);}finally{stats.serializationCalls++;stats.serializationMs+=performance.now()-start;}};
const clone=globalThis.structuredClone;
globalThis.structuredClone=(...args)=>{const start=performance.now();try{return clone(...args);}finally{stats.cloneCalls++;stats.cloneMs+=performance.now()-start;}};
let last=performance.now();const timer=setInterval(()=>{const now=performance.now(),lag=Math.max(0,now-last-100);last=now;stats.lagSamples++;stats.lagTotalMs+=lag;stats.lagMaxMs=Math.max(stats.lagMaxMs,lag);},100);timer.unref();
function observe(Pool){
  const connect=Pool.prototype.connect;
  Pool.prototype.connect=function(...args){
    const start=performance.now(),done=()=>{const ms=performance.now()-start;stats.poolAcquisitions++;stats.poolWaitMs+=ms;stats.poolWaitMaxMs=Math.max(stats.poolWaitMaxMs,ms);};
    if(typeof args[0]==='function'){const cb=args[0];return connect.call(this,(...result)=>{done();cb(...result);});}
    return connect.apply(this,args).finally(done);
  };
}
observe(require('pg').Pool);
if(variant==='native')observe(require('./native-pool.cjs').Pool);
const hashes={};
for(const name of ['aggregate-snapshot.cjs','read-model.cjs','pg-adapter.cjs','main.cjs']){
  const filename=path.resolve(__dirname,'..',name);
  let source=transform(name,fs.readFileSync(filename,'utf8'),variant);
  if(name==='aggregate-snapshot.cjs'){
    source=source.replace('const names=data.streets.map','const computeStart=performance.now();\n  const names=data.streets.map');
    source=source.replace('return {territory:data.territory',"globalThis.__candidateStage('snapshotCompute',performance.now()-computeStart);\n  return {territory:data.territory");
  }
  if(name==='pg-adapter.cjs')source=source.replace('counters.queries++; counters.queryMs += performance.now()-begin;',"counters.queries++; counters.queryMs += performance.now()-begin; const text=typeof args[0]==='string'?args[0]:args[0].text; globalThis.__candidateStage(text.includes('field_read_model')?'readModelSQL':text.includes('FROM signature s LEFT JOIN')?'validationSQL':text.includes('field_session')?'presenceSQL':'otherSQL',performance.now()-begin);");
  if(name==='main.cjs')source=source.replace('JSON.stringify(body)','globalThis.__candidateSerialize(body)');
  hashes[name]=createHash('sha256').update(source).digest('hex');
  // Compile only the two overridden dependencies; main is compiled after instrumentation.
  if(name==='main.cjs')continue;
  const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
  require.cache[filename]=loaded;loaded._compile(source,filename);
}
const factoryPath=require.resolve('../pg-adapter.cjs'),factory=require(factoryPath);
require.cache[factoryPath].exports=(...args)=>{const db=factory(...args),original=db.$stats;db.$stats=()=>{
  let cpuStat=null;try{cpuStat=fs.readFileSync('/sys/fs/cgroup/cpu.stat','utf8');}catch{}
  return {...original(),candidate:{...stats,hashes,bunVersion:Bun.version,processCPU:process.cpuUsage(),memory:process.memoryUsage(),cpuStat}};
};return db;};
const filename=path.resolve(__dirname,'../main.cjs');
const source=fs.readFileSync(filename,'utf8').replace('JSON.stringify(body)','globalThis.__candidateSerialize(body)');
const entry=new Module(filename,module);entry.filename=filename;entry.paths=Module._nodeModulePaths(path.dirname(filename));entry._compile(source,filename);
