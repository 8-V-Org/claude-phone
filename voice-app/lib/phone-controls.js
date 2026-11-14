'use strict';
const fs=require('node:fs');
const {featurePolicy,voicemailPin,fail}=require('./phone-feature-policy');
const {bounded,holdSdp,reinvite,replacesValue,referVerified}=require('./sip-features');
const {PresenceWatch}=require('./phone-presence');
const {audit}=require('./phone-diagnostics');
const {bodyOf}=require('./live-fork');
const names=['phone_capabilities','transfer_blind','transfer_attended','call_park','call_unpark','call_pickup','presence_set','presence_watch','voicemail_leave','voicemail_check','xapi_call_logs','xapi_recordings'];
class PhoneControls {
 constructor({tier,dialog,endpoint,srf,mediaServer,phoneConfig,callId,suspendMedia=async()=>{},resumeMedia=async()=>{},onTransferred=()=>{},secretDir='/run/phone-secrets',transferTimeoutMs=25000,legTimeoutMs=20000}){Object.assign(this,{tier,dialog,endpoint,srf,mediaServer,config:phoneConfig,callId,suspendMedia,resumeMedia,onTransferred,secretDir,transferTimeoutMs,legTimeoutMs});this.policy=featurePolicy(phoneConfig);this.abort=new AbortController();this.closed=false;this.busy=false;this.transferDispatched=false;this.legs=new Set();this.uncertain=false;this.watcher=null;this.bridgeCleanup=null;}
 capabilities(){return {license:'3CX v20 SMB Free (owner reported)',available:['SIP REFER transfers','park/unpark/pickup dial codes','own-extension profile dial codes','SIP dialog BLF subscriptions','voicemail dial codes'],verification:'Tenant permissions and human transfer/audio behavior need testing',pstnPolicy:'Enabled when PHONE_OUTBOUND_ALLOW_PSTN or dialPolicy.allowPstn is true; 10-digit, 11-digit and +E.164 are normalized; no destination allowlist; never infer a prefix',voicemailPinConfigured:fs.existsSync(this.secretDir+'/'+(this.config.voicemailPinFile||'voicemail-pin')),xapiConfigured:fs.existsSync(this.secretDir+'/xapi.json'),unavailable:{sms:'Use the owner SMS Cloudflare MCP server (portal server sms on ai-bot.8-v.org and ai-dev.8-v.org; Worker sms.leland-cheung.workers.dev/mcp; bearer auth). Not a 3CX SIP feature.',supervisor_barge_listen_whisper:'Not provided on this license',call_logs_recordings:'XAPI requires a separately entitled license/configuration; no XAPI credentials used'}};}
 uri(user){if(!/^[0-9+*#]{1,32}$/.test(user))fail('INVALID_DESTINATION','Invalid SIP dial destination');const host=this.config.registrar;if(!/^[a-z0-9.-]+$/i.test(host))fail('INVALID_REGISTRAR','Invalid configured registrar');return 'sip:'+encodeURIComponent(user)+'@'+host+':'+(this.config.registrar_port||5060);}
 async run(name,args={}){
  if(this.tier!=='approved')return {error:'Phone controls are restricted to approved-caller sessions',code:'APPROVED_ONLY'};
  if(!names.includes(name))return {error:'Unknown phone control',code:'UNKNOWN_TOOL'};
  if(this.closed)return {error:'Call ended',code:'CALL_ENDED'};
  if(name==='phone_capabilities')return this.capabilities();
  if(name.startsWith('xapi_'))return {available:false,configured:fs.existsSync(this.secretDir+'/xapi.json'),code:fs.existsSync(this.secretDir+'/xapi.json')?'XAPI_ENTITLEMENT_AND_SETUP_REQUIRED':'XAPI_NOT_CONFIGURED',message:'XAPI is not available on this owner-reported Free license. Stub only; no API credentials read or request made.'};
  if(this.busy||this.bridgeCleanup)return {error:'Another phone operation or connected feature session is active',code:'PHONE_BUSY'};
  if(this.uncertain)return {error:'Previous SIP action has an uncertain outcome; do not automatically repeat it',code:'PHONE_STATE_UNCERTAIN'};
  if(name!=='presence_watch'&&args.confirmed!==true)return {error:'Confirm the exact action/destination with the caller first, then set confirmed=true',code:'CONFIRMATION_REQUIRED'};
  this.busy=true;audit('phone-control-start',{callId:this.callId,tool:name});
  try{
   let result;
   if(name==='presence_watch'){if(!['start','status','stop'].includes(args.action))fail('INVALID_WATCH_ACTION','Use start, status or stop');const target=this.policy.extension(args.extension);this.watcher ||= new PresenceWatch({srf:this.srf,config:this.config});result=args.action==='stop'?await this.watcher.stop(target):args.action==='status'?this.watcher.status(target):await this.watcher.start(target);}
   else if(name==='transfer_blind')result=await this.transfer(this.uri(this.policy.target(args.target)));
   else if(name==='transfer_attended')result=await this.attended(this.policy.target(args.target));
   else if(name==='call_park')result=await this.transfer(this.uri(this.policy.code(name,{orbit:args.orbit})));
   else if(name==='call_unpark'||name==='call_pickup'){const ext=args.extension?this.policy.extension(args.extension):'';const code=this.policy.code(name,{orbit:args.orbit,ext});result=await this.connectFeature(code);}
   else if(name==='voicemail_leave'){const ext=this.policy.extension(args.extension);result=await this.transfer(this.uri(this.policy.code(name,{ext})));}
   else if(name==='presence_set'){const states={available:'presence_available',away:'presence_away',dnd:'presence_dnd',custom1:'presence_custom1',custom2:'presence_custom2'};if(!states[args.status])fail('INVALID_PROFILE','Use available, away, dnd, custom1 or custom2');const leg=await this.leg(this.policy.code(states[args.status]));await this.dropLeg(leg);result={requested:true,verified:false,scope:'This assistant extension only',message:'PBX answered the profile dial-code call; profile application is not independently verified'};}
   else if(name==='voicemail_check'){const pin=voicemailPin(this.secretDir,this.config);result=await this.connectFeature(this.policy.code(name),pin);}
   audit('phone-control-result',{callId:this.callId,tool:name,completed:result.completed===true,accepted:result.accepted===true,code:result.code||null});return result;
  }catch(error){if(error.code==='SIP_TIMEOUT')this.uncertain=true;const code=typeof error.code==='string'&&/^[A-Z_0-9]{1,50}$/.test(error.code)?error.code:Number.isInteger(error.status)?'SIP_'+error.status:'PHONE_OPERATION_FAILED';audit('phone-control-failed',{callId:this.callId,tool:name,code});return {error:'Phone operation did not confirm completion. '+(code==='PIN_NOT_CONFIGURED'?'Owner must add a private voicemail-pin file.':'Do not automatically retry side effects.'),code,completed:false};}
  finally{this.busy=false;this.transferDispatched=false;if(this.abort.signal.aborted&&!this.closed)this.abort=new AbortController();}
 }
 cancelOperation(){if(!this.busy)return;if(this.transferDispatched)this.uncertain=true;audit('phone-control-cancelled',{callId:this.callId,transferAlreadyDispatched:this.transferDispatched});this.abort.abort();}
 async transfer(uri){
  if(this.abort.signal.aborted)fail('OPERATION_CANCELLED','Phone action cancelled');this.transferDispatched=true;
  const result=await referVerified(this.dialog,uri,{signal:this.abort.signal,timeoutMs:this.transferTimeoutMs,referredBy:'sip:'+this.config.extension+'@'+this.config.domain});
  if(result.completed){this.onTransferred();}else if(result.code==='TRANSFER_UNCONFIRMED')this.uncertain=true;return result;
 }
 async attended(target){
  const original=this.dialog.local.sdp;let held=false,leg,result;
  try{
   await this.suspendMedia();if(this.abort.signal.aborted)fail('OPERATION_CANCELLED','Phone action cancelled');await reinvite(this.dialog,holdSdp(original),{timeoutMs:15000});held=true;
   leg=await this.leg(target);
   const uri=this.uri(target)+'?Replaces='+replacesValue(leg.dialog);
   result=await this.transfer(uri);return {...result,mode:'SIP attended/Replaces',consultationAnswered:true,spokenPrivateConsultation:false};
  }finally{
   // Keep the consultation dialog alive until the final REFER NOTIFY arrives.
   if(leg)await this.dropLeg(leg);
   if(held&&!result?.completed&&!this.closed){try{await reinvite(this.dialog,holdSdp(original,2,false),{timeoutMs:5000});}catch{this.uncertain=true;audit('phone-hold-restore-failed',{callId:this.callId});}}
   if(!result?.completed&&!this.closed)await this.resumeMedia();
  }
 }
 async leg(user){
  if(this.closed||this.abort.signal.aborted)fail('CALL_ENDED','Call ended');if(this.legs.size>=1)fail('AUXILIARY_LIMIT','One auxiliary call at a time');
  const leg={endpoint:null,dialog:null,request:null,ended:false};this.legs.add(leg);let timer,abortListener;const signal=this.abort.signal;
  try{
   const creating=Promise.resolve(this.mediaServer.createEndpoint()).then(endpoint=>{if(leg.ended){void Promise.resolve(endpoint.destroy()).catch(()=>{});throw Error('Late endpoint released');}leg.endpoint=endpoint;return endpoint;});
   await bounded(creating,5000);
   const calling=Promise.resolve(this.srf.createUAC(this.uri(user),{localSdp:leg.endpoint.local.sdp,followRedirects:false,headers:{From:'<sip:'+this.config.extension+'@'+this.config.domain+'>',Contact:'<sip:'+this.config.extension+'@'+this.config.externalIp+':5060>',Supported:'replaces','User-Agent':'OpenClaw-Phone/1.0'},auth:{username:this.config.authId,password:this.config.password}},{cbRequest:(error,req)=>{if(!error){leg.request=req;if(leg.ended)try{req.cancel();}catch{}}}})).then(dialog=>{if(leg.ended||this.closed){void Promise.resolve(dialog.destroy()).catch(()=>{});throw Error('Late answered consultation released');}leg.dialog=dialog;return dialog;});
   await Promise.race([calling,new Promise((_,reject)=>{abortListener=()=>reject(Object.assign(Error('Auxiliary call cancelled'),{code:'OPERATION_CANCELLED'}));if(signal.aborted)abortListener();else signal.addEventListener('abort',abortListener,{once:true});}),new Promise((_,reject)=>timer=setTimeout(()=>reject(Object.assign(Error('Auxiliary call ring timeout'),{code:'SIP_TIMEOUT'})),this.legTimeoutMs))]);
   await bounded(leg.endpoint.modify(leg.dialog.remote.sdp),5000);return leg;
  }catch(error){await this.dropLeg(leg);throw error;}finally{clearTimeout(timer);if(abortListener)signal.removeEventListener('abort',abortListener);}
 }
 async dropLeg(leg){if(leg.ended)return;leg.ended=true;if(!leg.dialog)try{leg.request?.cancel();}catch{}if(leg.dialog)try{await bounded(Promise.resolve(leg.dialog.destroy()),2000);}catch{}if(leg.endpoint)try{await bounded(Promise.resolve(leg.endpoint.destroy()),2000);}catch{}this.legs.delete(leg);}
 async connectFeature(user,pin){
  const leg=await this.leg(user);try{
   await this.suspendMedia();
   if(pin){try{const configuredDelay=Number(this.config.voicemailPinDelayMs);const delay=Number.isSafeInteger(configuredDelay)&&configuredDelay>=1000&&configuredDelay<=15000?configuredDelay:3000;await new Promise(resolve=>setTimeout(resolve,delay));if(this.closed)fail('CALL_ENDED','Call ended before voicemail PIN transmission');const response=await bounded(leg.endpoint.api('uuid_send_dtmf',[leg.endpoint.uuid,pin+'#']),5000);if(!bodyOf(response).startsWith('+OK'))throw Error('DTMF rejected');}catch{fail('PIN_TRANSMIT_FAILED','Voicemail PIN delivery was not confirmed');}}
   const response=await bounded(this.endpoint.api('uuid_bridge',[this.endpoint.uuid,leg.endpoint.uuid]),5000);if(!bodyOf(response).startsWith('+OK'))fail('FEATURE_BRIDGE_FAILED','Feature bridge not acknowledged');
   let cleaned=false;const cleanup=async()=>{if(cleaned)return;cleaned=true;this.bridgeCleanup=null;try{await bounded(this.endpoint.api('uuid_transfer',[this.endpoint.uuid,'park','inline']),2000);}catch{}await this.dropLeg(leg);if(!this.closed)await this.resumeMedia();};
   this.bridgeCleanup=cleanup;leg.dialog.once('destroy',()=>void cleanup());return {connected:true,completed:false,verified:false,message:'Connected the caller to the PBX feature/voicemail. AI audio is paused until that feature leg ends; the PBX operation itself is not independently verified'};
  }catch(error){await this.dropLeg(leg);if(!this.closed)await this.resumeMedia();throw error;}
 }
 async close(){if(this.closed)return;this.closed=true;this.abort.abort();if(this.bridgeCleanup)await this.bridgeCleanup();await Promise.all([...this.legs].map(leg=>this.dropLeg(leg)));await this.watcher?.close();}
}
module.exports={PhoneControls,names};
