'use strict';
const {fail}=require('./phone-feature-policy');
function bounded(promise,ms=10000){let timer;return Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Object.assign(Error('SIP operation timed out; outcome may be unknown'),{code:'SIP_TIMEOUT'})),ms))]).finally(()=>clearTimeout(timer));}
function finalRequest(dialog,options,{timeoutMs=15000,signal}={}){
 return new Promise((resolve,reject)=>{let settled=false;const end=(error,res)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(res);};const abort=()=>end(Object.assign(Error('Call ended; SIP operation outcome may be unknown'),{code:'OPERATION_CANCELLED'}));const timer=setTimeout(()=>end(Object.assign(Error('SIP final response timed out; do not automatically retry'),{code:'SIP_TIMEOUT'})),timeoutMs);if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});try{dialog.request(options,(error,res)=>{if(error)return end(error);if(Number(res?.status)>=200)end(null,res);});}catch(error){end(error);}});
}
function holdSdp(sdp,increment=1,hold=true){const transform=require(require.resolve('sdp-transform',{paths:[require.resolve('drachtio-srf')]}));const parsed=transform.parse(sdp);if(!parsed.media?.some(m=>m.type==='audio'))fail('INVALID_SDP','Cannot hold call without audio SDP');if(parsed.origin){const v=Number(parsed.origin.sessionVersion);if(Number.isSafeInteger(v))parsed.origin.sessionVersion=v+increment;}if(hold)for(const m of parsed.media)if(m.type==='audio'&&m.port!==0)m.direction='inactive';return transform.write(parsed);}
async function reinvite(dialog,sdp,options){const res=await finalRequest(dialog,{method:'INVITE',headers:{Contact:dialog.local.contact,'Content-Type':'application/sdp'},body:sdp},options);if(res.status!==200)fail('HOLD_REJECTED','PBX rejected media renegotiation (SIP '+res.status+')');dialog.local.sdp=sdp;if(res.body)dialog.remote.sdp=res.body;return res;}
function replacesValue(dialog){const s=dialog.sip;if(!s?.callId||!s.localTag||!s.remoteTag)fail('INVALID_REPLACES','Consultation dialog identifiers missing');return encodeURIComponent(s.callId+';to-tag='+s.remoteTag+';from-tag='+s.localTag);}
async function referVerified(dialog,uri,{signal,timeoutMs=25000,referredBy}={}){
 let notifyResolve,timer,accepted=false,expectedId=null,last=null;const notifications=new Promise(resolve=>notifyResolve=resolve);
 const maybe=()=>{if(!accepted||!last)return;if(last.id&&expectedId&&last.id!==expectedId)return;notifyResolve({accepted:true,completed:last.status>=200&&last.status<300,sipStatus:last.status,verification:'refer-notify'});};
 const handler=(req,res)=>{res.send(200);if(!/^refer(?:;|$)/i.test(req.get('Event')||''))return;if(!/^message\/sipfrag(?:;|$)/i.test(req.get('Content-Type')||''))return;const body=typeof req.body==='string'?req.body:'';if(body.length>4096)return;const m=/^SIP\/2\.0\s+(\d{3})(?:\s|$)/i.exec(body.trim());if(!m||Number(m[1])<200)return;const id=/;\s*id=(\d+)/i.exec(req.get('Event')||'');last={status:Number(m[1]),id:id?.[1]||null};maybe();};
 const abort=()=>notifyResolve({accepted,completed:false,code:'TRANSFER_UNCONFIRMED',verification:'call-ended-or-cancelled'});
 dialog.on('notify',handler);signal?.addEventListener('abort',abort,{once:true});
 try{
  if(signal?.aborted)return {accepted:false,completed:false,code:'OPERATION_CANCELLED'};
  const res=await finalRequest(dialog,{method:'REFER',headers:{'Refer-To':'<'+uri+'>','Refer-Sub':'true',...(referredBy?{'Referred-By':'<'+referredBy+'>'}:{})}},{signal,timeoutMs:Math.min(timeoutMs,15000)});
  if(res.status<200||res.status>=300)return {accepted:false,completed:false,sipStatus:res.status,code:'REFER_REJECTED'};
  accepted=true;expectedId=/^(\d+)\s+REFER/i.exec(res.get?.('CSeq')||'')?.[1]||null;maybe();
  return await Promise.race([notifications,new Promise(resolve=>timer=setTimeout(()=>resolve({accepted:true,completed:false,code:'TRANSFER_UNCONFIRMED',verification:'missing-final-notify'}),timeoutMs))]);
 }finally{clearTimeout(timer);dialog.removeListener('notify',handler);signal?.removeEventListener('abort',abort);}
}
module.exports={bounded,finalRequest,holdSdp,reinvite,replacesValue,referVerified};
