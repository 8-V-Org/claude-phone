'use strict';
const {runLiveCall,deadline}=require('./live-call');
const {audit}=require('./phone-diagnostics');
const {normalizeDestination,acceptedDestination}=require('./destination');
function destination(to,config){
 const n=normalizeDestination(to,{allowPstn:true});
 if(!acceptedDestination(n))throw Error((n&&n.message)||'Invalid destination');
 if(n.to===config.sip.extension)throw Error('Self-call forbidden');
 const host=config.sip.registrar;
 if(!/^[a-zA-Z0-9.-]+$/.test(host))throw Error('Invalid configured registrar');
 return 'sip:'+n.to+'@'+host+':'+config.sip.registrar_port+';transport=udp';
}
async function dialLive({srf,mediaServer,audioForkServer,config,capacity,to,conversation=false,message,wsPort=3001,runCall=runLiveCall,ringMs=30000,durationMs=0}){
 if(message!==undefined&&(!conversation||typeof message!=='string'||!message.trim()||message.length>2000||/[\x00-\x1f\x7f]/.test(message)))throw Error('Invalid outbound message');
 const uri=destination(to,config),release=capacity.acquire();if(!release)throw Object.assign(Error('Call capacity reached'),{code:'CALL_CAPACITY'});
 let endpoint,dialog,request,ended=false,ringTimer,callTimer;let answered=false;const progress=[];
 try{
  const creating=Promise.resolve(mediaServer.createEndpoint()).then(e=>{if(ended){Promise.resolve(e.destroy()).catch(()=>{});throw Error('Endpoint arrived after timeout');}return e;});
  endpoint=await deadline(creating);
  const ringing=new Promise((_,reject)=>{ringTimer=setTimeout(()=>{ended=true;try{request?.cancel();}catch{}reject(Object.assign(Error('No answer within ring deadline'),{code:'RING_TIMEOUT'}));},ringMs);});
  const calling=Promise.resolve(srf.createUAC(uri,{localSdp:endpoint.local.sdp,followRedirects:false,headers:{From:'<sip:'+config.sip.extension+'@'+config.sip.domain+'>',Contact:'<sip:'+config.sip.extension+'@'+config.external_ip+':'+(Number(process.env.DRACHTIO_SIP_PORT)||5060)+'>','User-Agent':'OpenClaw-Phone/1.0'},auth:{username:config.sip.auth_id,password:config.sip.password}},{cbRequest:(err,req)=>{if(!err){request=req;if(ended)try{req.cancel();}catch{}}},cbProvisional:res=>{if(progress.length<8)progress.push(Number(res.status));}})).then(d=>{if(ended){Promise.resolve(d.destroy()).catch(()=>{});throw Error('Late answered dialog was ended');}return d;});
  dialog=await Promise.race([calling,ringing]);clearTimeout(ringTimer);answered=true;
  await deadline(endpoint.modify(dialog.remote.sdp));
  const opts={audioForkServer,wsPort,srf,mediaServer,callContext:{tier:conversation?'approved':'message-only'},outbound:true,outboundMessage:message};
  if(durationMs>0){
   const deadlineAt=Date.now()+durationMs;
   opts.deadlineAt=deadlineAt;
   callTimer=setTimeout(()=>{audit('outbound-local-end-request',{callId:endpoint.uuid,reason:'duration-limit',durationMs});if(dialog.connected!==false)Promise.resolve(dialog.destroy()).catch(()=>{});},durationMs);
  }
  const sessionResult=await runCall(endpoint,dialog,endpoint.uuid,opts);
  return {answered:true,completed:true,provisionalStatuses:progress,...(sessionResult?.endReason?{endReason:sessionResult.endReason}:{})};
 }catch(error){return {answered,completed:false,code:error.code==='RING_TIMEOUT'?'RING_TIMEOUT':error.code==='CALL_CAPACITY'?'CALL_CAPACITY':Number.isInteger(error.status)?'SIP_'+error.status:'CALL_FAILED',...(Number.isInteger(error.status)?{sipStatus:error.status}:{}),provisionalStatuses:progress};}
 finally{ended=true;clearTimeout(ringTimer);clearTimeout(callTimer);if(!dialog)try{request?.cancel();}catch{}if(dialog&&dialog.connected!==false)try{audit('outbound-local-end-request',{callId:endpoint?.uuid||null,reason:'final-cleanup'});await deadline(Promise.resolve(dialog.destroy()),2000);}catch{}if(endpoint)try{await deadline(Promise.resolve(endpoint.destroy()),2000);}catch{}release();}
}
module.exports={destination,dialLive};
