const {performance}=require('node:perf_hooks');
const assert=require('node:assert/strict');
const rows=Array.from({length:150},(_,i)=>({id:i,number:String(i%50+1)}));
const collator=new Intl.Collator('pt-BR',{numeric:true});
const previous=(a,b)=>a.number.localeCompare(b.number,'pt-BR',{numeric:true})||a.id-b.id;
const next=(a,b)=>collator.compare(a.number,b.number)||a.id-b.id;
const results=[];
for(let run=0;run<3;run++){
 const ms={};let before,after;
 for(const [name,compare] of [['localeCompare',previous],['sharedCollator',next]]){
  const started=performance.now();
  for(let i=0;i<20;i++){const value=rows.slice().sort(compare);if(name==='localeCompare')before=value;else after=value;}
  ms[name]=(performance.now()-started)/20;
 }
 assert.deepEqual(before,after);results.push({run:run+1,ms_per_sort:ms,identical:true});
}
console.log(JSON.stringify({items:150,iterations_per_run:20,runs:results},null,2));
