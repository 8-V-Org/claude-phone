'use strict';
const {randomUUID}=require('node:crypto');
const {bounded,finalRequest}=require('./sip-features');
const {fail}=require('./phone-feature-policy');
const registries=new WeakMap();
function registry(srf){if(registries.has(srf))return registries.get(srf);const map=new Map();srf.notify((req,res,next)=>{const item=map.get(req.get('Call-ID'));if(!item){if(next)return next();return res.send(481);}const source=String(req.source_address||'').replace(/^::ffff:/,'');if(!item.sources.has(source))return res.send(403);item.handler(req,res);});registries.set(srf,map);return map;}
function parseDialogInfo(body,target,domain,prior={dialogs:{},version:null}){
 if(typeof body!=='string'||body.length>32768||/<!DOCTYPE|<!ENTITY/i.test(body))fail('INVALID_BLF','BLF body must be bounded XML without entities');
 const root=/<dialog-info\b([^>]*)>/i.exec(body);if(!root)fail('INVALID_BLF','Missing dialog-info');const attr=name=>new RegExp('\\b'+name+'=["\']([^"\']+)["\']','i').exec(root[1])?.[1];
 const entity=attr('entity'),version=Number(attr('version')),kind=attr('state');if(!entity||!Number.isSafeInteger(version)||version<0||!['full','partial'].includes(kind))fail('INVALID_BLF','Invalid BLF metadata');const match=/^sips?:([^@]+)@([^;:?>]+)(?::\d+)?(?:;.*)?$/i.exec(entity);if(!match||match[1]!==target||match[2].toLowerCase()!==domain.toLowerCase())fail('INVALID_BLF','BLF entity does not match subscribed extension');
 if(prior.version!==null&&version<=prior.version)return prior;
 if(kind==='partial'&&(prior.version===null||version!==prior.version+1))return {...prior,resyncRequired:true};
 const dialogs=kind==='full'?{}:{...prior.dialogs};const re=/<dialog\b[^>]*\bid=["']([^"']{1,128})["'][^>]*>([\s\S]*?)<\/dialog>/gi;let m,count=0;
 while((m=re.exec(body))){if(++count>64)fail('INVALID_BLF','Too many BLF dialogs');const state=/<state(?:\s[^>]*)?>\s*(trying|proceeding|early|confirmed|terminated)\s*<\/state>/i.exec(m[2])?.[1]?.toLowerCase();if(!state)continue;if(state==='terminated')delete dialogs[m[1]];else dialogs[m[1]]=state;}
 return {dialogs,version,resyncRequired:false,lastUpdate:Date.now(),state:Object.values(dialogs).includes('confirmed')?'in-use':Object.values(dialogs).some(s=>s==='early')?'ringing':Object.keys(dialogs).length?'progress':'idle'};
}
class PresenceWatch {
 constructor({srf,config}){Object.assign(this,{srf,config});this.watches=new Map();this.registry=registry(srf);this.closed=false;}
 async start(target){if(this.closed)fail('CALL_ENDED','Call has ended');if(this.watches.has(target))return this.status(target);if(this.watches.size>=4)fail('BLF_LIMIT','At most four BLF watches per call');
  const callId=randomUUID(),item={callId,target,state:{dialogs:{},version:null,state:'unknown'},sources:new Set((this.config.sources||[]).map(source=>String(source).replace(/^::ffff:/,''))),timer:null,dialog:null};
  item.handler=(req,res)=>{if(!item.sources.has(String(req.source_address||'').replace(/^::ffff:/,'')))return res.send(403);res.send(200);if(!/^dialog(?:;|$)/i.test(req.get('Event')||'')||!/^application\/dialog-info\+xml(?:;|$)/i.test(req.get('Content-Type')||''))return;try{item.state=parseDialogInfo(req.body,target,this.config.domain,item.state);}catch{item.state={...item.state,state:'unknown',invalidNotification:true};}if(/^terminated/i.test(req.get('Subscription-State')||'')){clearTimeout(item.timer);item.terminated=true;item.state={...item.state,state:'unknown',terminated:true};}};
  this.registry.set(callId,item);this.watches.set(target,item);
  try{
   let stopped=false;const creating=Promise.resolve(this.srf.createUAC('sip:'+target+'@'+this.config.registrar+':'+(this.config.registrar_port||5060),{method:'SUBSCRIBE',headers:{From:'<sip:'+this.config.extension+'@'+this.config.domain+'>',Contact:'<sip:'+this.config.extension+'@'+this.config.externalIp+':5060>','Call-ID':callId,Event:'dialog',Accept:'application/dialog-info+xml',Expires:'120'},auth:{username:this.config.authId,password:this.config.password}})).then(dialog=>{if(stopped||this.closed||!this.watches.has(target)){void finalRequest(dialog,{method:'SUBSCRIBE',headers:{Event:'dialog',Expires:'0'}},{timeoutMs:3000}).catch(()=>{});throw Error('Late subscription was released');}return dialog;});
   try{item.dialog=await bounded(creating,15000);}catch(error){stopped=true;throw error;}
   item.dialog.on('notify',item.handler);this.schedule(item);return this.status(target);
  }catch(error){this.registry.delete(callId);this.watches.delete(target);return {supported:false,verified:false,code:Number.isInteger(error.status)?'SIP_'+error.status:error.code||'BLF_UNAVAILABLE',message:'BLF subscription was not established; tenant rights/license support remains unverified'};}
 }
 schedule(item){if(this.closed||item.terminated)return;const granted=Number(item.dialog.res?.get?.('Expires'))||120;item.timer=setTimeout(async()=>{try{const response=await finalRequest(item.dialog,{method:'SUBSCRIBE',headers:{Event:'dialog',Accept:'application/dialog-info+xml',Expires:'120'}},{timeoutMs:10000});if(response.status===423){const minimum=Number(response.get?.('Min-Expires'));if(Number.isInteger(minimum)&&minimum>0&&minimum<=600){const retried=await finalRequest(item.dialog,{method:'SUBSCRIBE',headers:{Event:'dialog',Accept:'application/dialog-info+xml',Expires:String(minimum)}},{timeoutMs:10000});if(retried.status>=300)throw Error('BLF refresh rejected');}else throw Error('BLF minimum expiry not supported');}else if(response.status>=300)throw Error('BLF refresh rejected');this.schedule(item);}catch{item.state={...item.state,state:'unknown',refreshFailed:true};}},Math.max(1000,Math.min(granted,120)*750));}
 status(target){const item=this.watches.get(target);if(!item)return {watching:false,state:'unknown'};const stale=!item.state.lastUpdate||Date.now()-item.state.lastUpdate>150000;return {watching:true,subscriptionEstablished:!!item.dialog,state:stale||item.state.resyncRequired?'unknown':item.state.state,stale,resyncRequired:!!item.state.resyncRequired,meaning:'BLF call state only, not DND/profile/registration or human availability'};}
 async stop(target){const item=this.watches.get(target);if(!item)return {watching:false};clearTimeout(item.timer);this.registry.delete(item.callId);this.watches.delete(target);if(item.dialog){item.dialog.removeListener('notify',item.handler);try{await finalRequest(item.dialog,{method:'SUBSCRIBE',headers:{Event:'dialog',Expires:'0'}},{timeoutMs:3000});}catch{}this.srf.removeDialog?.(item.dialog);}return {watching:false};}
 async close(){this.closed=true;await Promise.all([...this.watches.keys()].map(target=>this.stop(target)));}
}
module.exports={PresenceWatch,parseDialogInfo};
