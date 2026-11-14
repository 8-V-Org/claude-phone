'use strict';
const fs=require('node:fs'),path=require('node:path');
const {getMessageStore}=require('./message-store'),{audit,failure}=require('./phone-diagnostics');
const {dialLive}=require('./live-outbound');
function startWorker(deps,{fetchImpl=fetch,intervalMs=2000}={}){
 const token=fs.readFileSync(process.env.PHONE_BRIDGE_TOKEN_FILE,'utf8').trim();let stopped=false,timer,busy=false,pending=null;
 const post=async(route,data)=>{const r=await fetchImpl('http://127.0.0.1:3333/phone/'+route,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Bridge operation rejected');return r.json();};
 async function execute(job){
  try{
   let result;
   if(job.action==='status'&&typeof job.to==='string'&&job.to.startsWith(require('./private-message-read').PREFIX)){const store=getMessageStore();if(!store)throw Error('Private store unavailable');result=await require('./private-message-read').readSealedMessage(store,job.to);}
   else if(job.action==='status'){const store=getMessageStore();result={registrations:deps.registrar.getStatus(),inboxAvailable:!!store,inboxCount:store?fs.readdirSync(store.dir).filter(n=>n.endsWith('.json')).length:null,activeCalls:deps.capacity.active};}
   else if(job.action==='probe-save'){
    const store=getMessageStore();if(!store)throw Object.assign(Error('Store unavailable'),{code:'STORE_UNAVAILABLE'});
    const saved=await store.save('diagnostic-'+job.id,{name:'Synthetic probe',callback:'000',reason:'Synthetic local storage diagnostic, not a real caller message.',consent:true});const stat=fs.statSync(path.join(store.dir,saved.reference+'.json'));
    result={probe:true,recorded:saved.recorded,reference:saved.reference,mode:(stat.mode&0o777).toString(8),bytes:stat.size,persistedPath:'/app/messages/'+saved.reference+'.json'};audit('message-probe-success',{reference:saved.reference,mode:result.mode});
   }else if(job.action==='dial'){audit('outbound-test-start',{jobId:job.id});result=await dialLive({...deps,to:job.to,conversation:job.conversation===true,message:job.message,...(job.conversation===true?{durationMs:180000}:{})});audit('outbound-test-result',{jobId:job.id,answered:result.answered,code:result.code||'OK'});}
   else throw Error('Unsupported operation');
   pending={id:job.id,success:result.completed!==false,result};
  }catch(error){pending={id:job.id,success:false,result:{error:'Phone operation failed',...failure(error)}};audit('phone-operation-failed',{jobId:job.id,...failure(error)});}
  finally{busy=false;}
 }
 async function tick(){if(stopped)return;try{
  if(pending){await post('result',pending);pending=null;}
  if(!busy){const {job}=await post('next',{});if(job){busy=true;void execute(job);}}
  else await post('next',{busy:true}); // heartbeat; server allows only one queued/running job
 }catch{}finally{if(!stopped)timer=setTimeout(tick,intervalMs);}}
 void tick();return {stop(){stopped=true;clearTimeout(timer);}};
}
module.exports={startWorker};
