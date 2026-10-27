// Keep the domain poll algorithm and its security checks; only sleep is event-aware.
function install(field,hub){
  // This adapter changes only waiting, but mirrors the domain loop. Refuse a
  // changed domain until its validation/transaction semantics have been reviewed.
  const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
  const hash=createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../dist/modules/field/field.service.js'))).digest('hex');
  if(hash!=='cd172157bd7acb543fcc5404e0a8e498daf6d1f18bbba5f087fd60719ed4cc42')throw Error('FieldService changed: review revision-poll compatibility before enabling notifications');
  field.poll=async function(user,query,signal,fullBlock=false,request){
    await hub.ready;
    const scope=await this.scope(user,query,fullBlock,request);
    await this.heartbeat(user,query,scope);
    const deadline=Date.now()+25000;
    while(!signal.aborted){
      const observed=hub.version(user,scope);
      const signature=await this.access.validate(user);
      scope.canEditStructure=user.roles.includes('overseer')&&signature.canEditStructure;
      const {key,entry}=this.currentRevision(user,scope),revision=await entry.value;
      if(query.cursor===undefined||query.cursor!==revision){
        const snapshot=await this.prisma.$transaction(async tx=>{
          const info=await this.rounds.resolve(user.tenantId,user.territoryId,user.round,tx);
          const setting=await tx.parameter.findUnique({where:{tenantId_key:{tenantId:user.tenantId,key:'SIGNATURE_EXPIRATION_HOURS'}}});
          scope.round=info?.roundNumber??null;
          scope.hours=require('../dist/modules/house/house-permissions.js').unmarkHours(setting?.value??null);
          return {cursor:await this.revision(user,scope,tx),data:await this.snapshot(tx,user,scope,info)};
        },{isolationLevel:'RepeatableRead'});
        if(snapshot.cursor!==revision&&this.revisions.get(key)===entry)this.revisions.delete(key);
        await this.access.validate(user);
        return {...snapshot,changed:true,presence:await this.presence(user,scope)};
      }
      if(Date.now()>=deadline)return {cursor:revision,changed:false,presence:await this.presence(user,scope)};
      await hub.wait(user,scope,observed,Math.min(this.checkInterval,deadline-Date.now()),signal);
    }
    return undefined;
  };
}
module.exports={install};
