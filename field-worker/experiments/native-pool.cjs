// Minimal pg-shaped query transport. Only loaded by the isolated candidate entrypoint.
const {SQL}=require('bun');
function normalize(result) {
  // Bun 1.3.14 has no result.columns metadata; bigint:true avoids precision loss.
  for(const row of result)for(const key of Object.keys(row)){
    if(typeof row[key]==='bigint')row[key]=row[key].toString();
    else if(ArrayBuffer.isView(row[key])&&!Buffer.isBuffer(row[key]))row[key]=Array.from(row[key],value=>typeof value==='bigint'?value.toString():value);
  }
  // Preserve pg's int8/numeric strings and timestamp values, including nested JSON.
  for(const column of result.columns||[]) if([20,1700].includes(column.type)) {
    for(const row of result)if(row[column.name]!==null)row[column.name]=String(row[column.name]);
  }
  return {rows:Array.from(result),rowCount:result.count};
}
class Pool {
  constructor(options){
    this.sql=new SQL(options.connectionString,{max:options.max,connectionTimeout:options.connectionTimeoutMillis/1000,idleTimeout:0,prepare:true,bigint:true});
    this.max=options.max;this.waiting=0;this.active=0;this.used=false;
  }
  on(){return this;}
  get totalCount(){return this.used?this.max:0;}
  get idleCount(){return this.used?Math.max(0,this.max-this.active):0;}
  get waitingCount(){return this.waiting;}
  async connect(){
    this.waiting++;
    let reserved;
    try{reserved=await this.sql.reserve();}finally{this.waiting--;}
    this.active++;this.used=true;let released=false;
    return {
      query:async(text,values)=>{
        if(typeof text==='object'){values=text.values;text=text.text;}
        values=[...(values||[])];
        // pg accepts pre-serialized JSON. Bun serializes JSON-typed parameters
        // itself; pass the parsed value or it stores a JSON string instead.
        for(const cast of text.matchAll(/\$(\d+)::jsonb?\b/g)){
          const index=Number(cast[1])-1;
          if(typeof values[index]==='string')values[index]=JSON.parse(values[index]);
        }
        return normalize(await reserved.unsafe(text,values));
      },
      release:(discard)=>{
        if(released)return;released=true;this.active--;
        // Rollback has already been attempted by the original adapter. A failed
        // rollback must never return an uncertain connection to a live pool.
        if(discard){this.sql.close({timeout:0});throw Error('Native connection unusable after rollback failure');}
        reserved.release();
      },
    };
  }
  async query(text,values){const client=await this.connect();try{return await client.query(text,values);}finally{client.release();}}
  end(){return this.sql.close();}
}
module.exports={Pool};
