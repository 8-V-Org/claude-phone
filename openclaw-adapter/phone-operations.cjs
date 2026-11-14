'use strict';
const {createHmac,timingSafeEqual,randomUUID}=require('node:crypto');
const {normalizeDestination,acceptedDestination}=require('../voice-app/lib/destination');
function derive(token,label){return createHmac('sha256',token).update(label).digest('hex');}
function equal(actual,expected){const a=Buffer.from(actual||''),b=Buffer.from('Bearer '+expected);return a.length===b.length&&timingSafeEqual(a,b);}
function createOperations({bridgeToken,send,body,now=Date.now}){
 const operator=derive(bridgeToken,'phone-operator-v1'),jobs=new Map();let lastWorkerAt=null;
 return async(req,res)=>{
  if(!req.url.startsWith('/phone/'))return false;
  const worker=['/phone/next','/phone/result'].includes(req.url);
  if(!equal(req.headers.authorization,worker?bridgeToken:operator)){send(res,401,{error:'Unauthorized'});return true;}
  try{
   for(const [id,j]of jobs){if(now()-j.createdAt>300000&&!['completed','failed','indeterminate'].includes(j.state)){j.state='indeterminate';j.result={error:'Operation exceeded observation deadline; do not automatically repeat a dial'};}if(now()-j.createdAt>3600000)jobs.delete(id);}
   if(req.method==='GET'&&req.url==='/phone/status'){send(res,200,{workerSeenAt:lastWorkerAt,workerRecent:lastWorkerAt!==null&&now()-lastWorkerAt<15000,queued:[...jobs.values()].filter(j=>['queued','running'].includes(j.state)).length});return true;}
   if(req.method==='POST'&&req.url==='/phone/jobs'){
    const data=await body(req);if(!data||!['probe-save','status','dial','validate'].includes(data.action))throw Object.assign(Error('Valid action required'),{status:400});
    if(data.action==='validate'){
     if(typeof data.to!=='string')throw Object.assign(Error('Use an internal extension, 10-digit, 11-digit, or +E.164 destination'),{status:400});
     const n=normalizeDestination(data.to,{allowPstn:true});
     if(n&&n.error)throw Object.assign(Error(n.message),{status:400,code:n.code});
     if(!acceptedDestination(n))throw Object.assign(Error('Use an internal extension, 10-digit, 11-digit, or +1 NANP destination'),{status:400});
     send(res,200,{ok:true,wouldDial:n.to,kind:n.kind,allowPstn:true,dryRun:true});return true;
    }
    if(typeof data.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(data.requestId))throw Object.assign(Error('Valid action and unique requestId required'),{status:400});
    if(data.action==='dial'){if(typeof data.to!=='string')throw Object.assign(Error('Use an internal extension, 10-digit, 11-digit, or +1 NANP destination'),{status:400});const n=normalizeDestination(data.to,{allowPstn:true});if(n&&n.error)throw Object.assign(Error(n.message),{status:400,code:n.code});if(!acceptedDestination(n))throw Object.assign(Error('Use an internal extension, 10-digit, 11-digit, or +1 NANP destination'),{status:400});data.to=n.to;}
    if(Object.keys(data).some(k=>!['action','requestId','to','conversation','message'].includes(k)))throw Object.assign(Error('Unexpected operation field'),{status:400});
    if(data.conversation!==undefined&&(data.action!=='dial'||typeof data.conversation!=='boolean'))throw Object.assign(Error('conversation must be a boolean on dial only'),{status:400});
    if(data.message!==undefined&&(data.action!=='dial'||data.conversation!==true||typeof data.message!=='string'||!data.message.trim()||data.message.length>2000||/[\x00-\x1f\x7f]/.test(data.message)))throw Object.assign(Error('message requires conversational dial and 1-2000 printable characters'),{status:400});
    let existing=[...jobs.values()].find(j=>j.requestId===data.requestId);if(existing){if(existing.action!==data.action||existing.to!==data.to||existing.conversation!==(data.conversation===true)||existing.message!==data.message)throw Object.assign(Error('requestId already used for a different operation'),{status:409});send(res,200,{id:existing.id,state:existing.state});return true;}
    if(jobs.size>=100||[...jobs.values()].some(j=>['queued','running'].includes(j.state)))throw Object.assign(Error('One operation at a time'),{status:429});
    if(lastWorkerAt===null||now()-lastWorkerAt>15000)throw Object.assign(Error('Voice worker unavailable'),{status:503});
    const job={id:randomUUID(),requestId:data.requestId,action:data.action,conversation:data.conversation===true,...(data.message!==undefined?{message:data.message}:{}),...(data.to?{to:data.to}:{}),state:'queued',createdAt:now()};jobs.set(job.id,job);send(res,202,{id:job.id,state:job.state});return true;
   }
   if(req.method==='GET'&&req.url.startsWith('/phone/jobs/')){const j=jobs.get(req.url.slice('/phone/jobs/'.length));send(res,j?200:404,j?{id:j.id,action:j.action,state:j.state,result:j.result||null}:{error:'Unknown job'});return true;}
   if(req.method==='POST'&&req.url==='/phone/next'){const workerState=await body(req);lastWorkerAt=now();const job=workerState.busy?null:[...jobs.values()].find(j=>j.state==='queued');if(job)job.state='running';send(res,200,{job:job?{id:job.id,action:job.action,to:job.to,conversation:job.conversation,...(job.message!==undefined?{message:job.message}:{})}:null});return true;}
   if(req.method==='POST'&&req.url==='/phone/result'){const data=await body(req),job=jobs.get(data?.id);if(!job||!['running','indeterminate'].includes(job.state))throw Object.assign(Error('No claimed job'),{status:409});if(!data.result||typeof data.result!=='object')throw Object.assign(Error('Result required'),{status:400});job.state=data.success===true?'completed':'failed';job.result=data.result;send(res,200,{success:true});return true;}
   send(res,404,{error:'Not found'});return true;
  }catch(error){send(res,error.status||500,{error:error.status?error.message:'Phone operation failed'});return true;}
 };
}
module.exports={derive,equal,createOperations};
