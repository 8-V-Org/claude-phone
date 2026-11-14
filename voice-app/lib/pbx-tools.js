'use strict';
const {randomUUID}=require('node:crypto');
const failure=(code)=>({ok:false,status:'failed',code});
/** Per-call instance. Only trusted SIP admission supplies callerTier, never tool arguments.
 * execute() returns signaling results; REFER 2xx is pending, NOTIFY sipfrag 2xx completes.
 * Parent owns media and must await close() on teardown. No global SIP middleware installed.
 */
class PbxTools {
  constructor({callerTier='message',dialog,registrar,operationTimeoutMs=30000,...options}={}) {
    this.approved=callerTier==='approved';this.dialog=dialog;this.registrar=registrar;
    this.options=options;this.closed=false;this.operations=new Map();this.active=null;this.watches=new Set();this.inFlight=new Set();
    this.timeout=Math.max(10,Math.min(operationTimeoutMs,120000));
  }
  declarations(){
    if(!this.approved||this.closed)return [];
    const spec=(name,description,properties={},required=[])=>({name,description,parameters:{type:'OBJECT',properties,required}});
    return [
      spec('transfer_blind','Request blind SIP transfer; final NOTIFY confirms completion.',{destination:{type:'STRING'}},['destination']),
      spec('transfer_attended','Hold caller and transfer using an independent answered leg and Replaces.',{destination:{type:'STRING'}},['destination']),
      spec('call_park','Park caller in orbit 1-9 using REFER.',{orbit:{type:'STRING'}},['orbit']),
      spec('call_unpark','Connect to parked call; optional internal extension.',{orbit:{type:'STRING'},ext:{type:'STRING'}},['orbit']),
      spec('call_pickup','Pick up ringing call, optionally from an internal extension.',{ext:{type:'STRING'}}),
      spec('presence_set','Dial presence state feature; outcome unconfirmed.',{state:{type:'STRING',enum:['available','away','dnd','custom1','custom2']}},['state']),
      spec('presence_watch','Watch internal SIP dialog BLF, not user availability status.',{destination:{type:'STRING'},seconds:{type:'INTEGER'}},['destination']),
      spec('voicemail_leave','Connect caller to an internal extension voicemail.',{ext:{type:'STRING'}},['ext']),
      spec('voicemail_check','Connect voicemail IVR. No mailbox contents are inferred.'),
      spec('pbx_blind_transfer','Request blind SIP transfer; acceptance is pending until NOTIFY. Prefer internal extensions.',{destination:{type:'STRING'}},['destination']),
      spec('pbx_attended_transfer','Hold caller, dial internal consultation leg, then REFER with Replaces. No spoken consultation is performed.',{destination:{type:'STRING'}},['destination']),
      spec('pbx_session_action','Dial configured park/unpark/pickup/presence/voicemail feature code. Feature outcome remains unconfirmed.',{action:{type:'STRING',enum:['park','unpark','pickup','presence','voicemail']},target:{type:'STRING'},state:{type:'STRING'}},['action']),
      spec('pbx_presence_watch','Bounded internal extension BLF dialog subscription; only observed NOTIFY states are returned.',{destination:{type:'STRING'},seconds:{type:'INTEGER'}},['destination']),
      spec('pbx_operation_status','Read transfer/session/watch status without inventing completion.',{operationId:{type:'STRING'}},['operationId']),
      ...['pbx_sms','pbx_supervisor','pbx_call_logs','pbx_recordings'].map(name=>spec(name,'Unavailable on this free-tier PBX: requires licensed functionality.')),
      ...(this.xapiAvailable()?[spec('pbx_xapi','Configuration file exists; API adapter is NOT IMPLEMENTED. Does not perform any API actions.')]:[]),
      spec('pbx_voicemail_check','Connect voicemail IVR and optionally send private configured PIN. Does not list or infer messages.')
    ];
  }
  destination(value){
    if(typeof value!=='string'||!(/^\d{2,6}$/.test(value)||( /^\+[1-9]\d{7,14}$/.test(value)&&this.options.allowPstn===true&&this.options.authorizePstn?.(value)===true)))throw Error('destination_denied');
    if(typeof this.registrar!=='string'||! /^(?:[a-z0-9.-]+)(?::\d{1,5})?$/i.test(this.registrar))throw Error('registrar_unavailable');
    return `sip:${value}@${this.registrar}`;
  }
  operation(id){return {...(this.operations.get(id)?.result||failure('operation_not_found'))};}
  async execute(name,args={}){
    if(!this.approved)return failure('forbidden');
    if(this.closed)return failure('closed');
    const aliases={transfer_blind:'pbx_blind_transfer',transfer_attended:'pbx_attended_transfer',presence_watch:'pbx_presence_watch',voicemail_check:'pbx_voicemail_check'};
    const actions={call_park:'park',call_unpark:'unpark',call_pickup:'pickup',presence_set:'presence',voicemail_leave:'voicemail_leave'};
    if(Object.hasOwn(actions,name)){args={...args,action:actions[name]};name='pbx_session_action';}
    if(Object.hasOwn(aliases,name))name=aliases[name];
    if(this.preparing&&!['pbx_operation_status','pbx_sms','pbx_supervisor','pbx_call_logs','pbx_recordings','pbx_xapi'].includes(name))return failure('busy');
    try {
      if(['pbx_sms','pbx_supervisor','pbx_call_logs','pbx_recordings'].includes(name))return failure('license_unavailable');
      if(name==='pbx_xapi')return failure(this.xapiAvailable()?'not_implemented':'license_unavailable');
      if(name==='pbx_operation_status')return this.operation(args.operationId);
      if(name==='pbx_presence_watch')return await this.watch(args);
      if(name==='pbx_session_action'){
        const code=this.featureCode(args);
        return args.action==='park'?await this.refer(this.featureUri(code)):await this.session(this.featureUri(code),false,args.action!=='presence');
      }
      if(name==='pbx_voicemail_check')return await this.session(this.featureUri(this.featureCode({action:'voicemail'})),true);
      if(name==='pbx_attended_transfer')return await this.attended(this.destination(args.destination));
      if(name==='pbx_blind_transfer')return await this.refer(this.destination(args.destination));
      return failure('unavailable');
    }catch(error){return failure(['destination_denied','registrar_unavailable','invalid_feature_code','dial_code_unconfigured'].includes(error.message)?error.message:'sip_operation_failed');}
  }
  async invite(uri,opts){
    let request,aborted=false,rejectWait;
    const cancel=()=>{aborted=true;try{if(request&&opts.method!=='SUBSCRIBE')request.cancel(()=>{});}catch{}rejectWait?.(Error('sip_deadline'));};
    const wait=new Promise((resolve,reject)=>{rejectWait=reject;});
    this.inFlight.add(cancel);const timer=setTimeout(cancel,this.timeout);timer.unref?.();
    try{
      const pending=this.options.srf.createUAC(uri,opts,{cbRequest:(error,req)=>{if(!error){request=req;if(aborted&&opts.method!=='SUBSCRIBE'){try{req.cancel(()=>{});}catch{}}}}});
      const guarded=Promise.resolve(pending).then(async dlg=>{
        if(aborted||this.closed){
          try{if(opts.method==='SUBSCRIBE'){await dlg.request({method:'SUBSCRIBE',headers:{Event:'dialog',Expires:0}});dlg.srf?.removeDialog(dlg);dlg.connected=false;}else await dlg.destroy();}catch{}
          throw Error('sip_deadline');
        }
        return dlg;
      });
      return await Promise.race([guarded,wait]);
    }finally{clearTimeout(timer);this.inFlight.delete(cancel);}
  }
  xapiAvailable(){try{return require('node:fs').statSync(this.options.xapiPath||'/run/phone-secrets/xapi.json').isFile();}catch{return false;}}
  async watch({destination,seconds=30}){
    if(typeof destination!=='string'||!/^\d{2,6}$/.test(destination))return failure('destination_denied');
    if(this.watches.size>=4)return failure('watch_limit');
    const uri=this.destination(destination),{srf,auth,extension}=this.options;
    if(!srf?.createUAC)return failure('sip_unavailable');
    if(!Number.isInteger(seconds)||seconds<1||seconds>120)return failure('invalid_lifetime');
    const sub=await this.invite(uri,{method:'SUBSCRIBE',auth,callingNumber:extension,headers:{Event:'dialog',Accept:'application/dialog-info+xml',Expires:seconds}});
    const id=randomUUID(),op={result:{ok:true,status:'pending',operationId:id,signaling:'subscribed',presence:'unknown'}};
    const finish=async()=>{
      if(op.ended)return;op.ended=true;clearTimeout(op.timer);sub.off('notify',notify);sub.off('destroy',finish);this.watches.delete(op);
      op.result.monitoringEnded=true;
      try{if(sub.connected)await sub.request({method:'SUBSCRIBE',headers:{Event:'dialog',Expires:0}});}catch{}
      // Dialog.destroy() incorrectly sends notifier-side NOTIFY for a UAC subscription.
      sub.srf?.removeDialog(sub);sub.connected=false;
    };
    const notify=(req,res)=>{
      res.send(200);
      if(/^dialog(?:;|$)/i.test(req.get('Event')||'')&&/^application\/dialog-info\+xml(?:;|$)/i.test(req.get('Content-Type')||'')&&typeof req.body==='string'&&req.body.length<=16384){
        const states=[...req.body.matchAll(/<(?:[\w.-]+:)?state\b[^>]*>\s*(trying|proceeding|early|confirmed|terminated)\s*<\//g)].map(x=>x[1]);
        op.result.presence=states.length===1?states[0]:'unknown';
      }
      if(/^terminated(?:;|$)/i.test(req.get('Subscription-State')||''))void finish();
    };
    op.finish=finish;this.operations.set(id,op);this.watches.add(op);sub.on('notify',notify);sub.on('destroy',finish);
    op.timer=setTimeout(()=>void finish(),seconds*1000);op.timer.unref?.();
    if(this.closed)await finish();return this.operation(id);
  }
  featureCode({action,target,state,orbit,ext}){
    if(action==='voicemail')action='voicemail_check';
    const defaults={park:'*0{orbit}',unpark:'*1{orbit}[{ext}]',pickup:'*20*[{ext}]',presence:{available:'*30',away:'*31',dnd:'*32',custom1:'*33',custom2:'*34'},voicemail_leave:'*4{ext}',voicemail_check:'999'};
    if(!Object.hasOwn(defaults,action))throw Error('invalid_feature_code');
    const codes=this.options.dialCodes||{};
    let code=Object.hasOwn(codes,action)?codes[action]:(action==='voicemail_check'&&Object.hasOwn(codes,'voicemail')?codes.voicemail:defaults[action]);
    if(action==='presence'&&code&&typeof code==='object')code=Object.hasOwn(code,state)?code[state]:undefined;
    if(typeof code!=='string')throw Error('dial_code_unconfigured');
    orbit=orbit??(['park','unpark'].includes(action)?target:undefined);
    ext=ext??(['pickup','voicemail_leave'].includes(action)?target:undefined);
    if(orbit!==undefined&&!/^[1-9]$/.test(String(orbit)))throw Error('invalid_feature_code');
    if(ext!==undefined&&(typeof ext!=='string'||!/^\d{2,6}$/.test(ext)))throw Error('invalid_feature_code');
    const values={target:target??orbit??ext,orbit,ext};
    code=code.replace(/\[\{(ext)\}\]/g,(_,key)=>values[key]??'');
    code=code.replace(/\{(target|orbit|ext)\}/g,(_,key)=>{
      const value=values[key];
      if(value===undefined||!/^\d{1,6}$/.test(String(value)))throw Error('invalid_feature_code');
      return value;
    });
    if(!/^[*#\d]{1,32}$/.test(code))throw Error('invalid_feature_code');
    return code;
  }
  featureUri(code){return this.destination('999').replace('999@',`${code.replaceAll('#','%23')}@`);}
  async session(uri,voicemail=false,bridge=true){
    if(this.active||this.preparing)return failure('busy');
    const {srf,mediaServer,auth,extension,voicemailPinPath}=this.options;
    // This is an explicit operator attestation, not proof that external ESL logs are safe.
    if(voicemail&&voicemailPinPath&&this.options.pinLoggingSafe!==true)return failure('private_dtmf_unavailable');
    if(!srf?.createUAC||!mediaServer?.createEndpoint)return failure('media_unavailable');
    this.preparing=true;let ep,second,suspended=false,bridged=false,cleaned=false;
    const cleanup=async()=>{
      if(cleaned)return;cleaned=true;
      if(bridged){try{await ep?.unbridge?.();}catch{}}
      for(const resource of [second,ep]){try{if(resource?.connected!==false)await resource?.destroy();}catch{}}
      if(suspended)await this.options.onSessionEnd?.({kind:'feature',closed:this.closed});
    };
    try{
      if(bridge){suspended=true;await this.options.onSessionStart?.({kind:'feature'});if(this.closed)throw Error('closed');}
      ep=await mediaServer.createEndpoint();if(this.closed)throw Error('closed');
      second=await this.invite(uri,{localSdp:ep.local.sdp,auth,callingNumber:extension,followRedirects:false});
      if(this.closed)throw Error('closed');await ep.modify(second.remote.sdp);
      if(bridge&&this.options.endpoint){bridged=true;await ep.bridge(this.options.endpoint);}
      let pinSent=false;
      if(voicemail&&voicemailPinPath){
        let pin;try{pin=(await require('node:fs/promises').readFile(voicemailPinPath,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw Error('pin_unreadable');}
        if(pin){
          if(!/^\d{1,16}$/.test(pin))throw Error('invalid_pin');
          // fsmrf Endpoint#execute logs arguments under DEBUG; refuse that diagnostic mode.
          if(require('debug').enabled('drachtio:fsmrf')||require('debug').enabled('drachtio:modesl'))throw Error('private_dtmf_unavailable');
          await ep.execute('send_dtmf',`${pin}#`);pinSent=true;pin=undefined;
        }
      }
      const id=randomUUID();const op={result:{ok:true,status:'pending',operationId:id,signaling:'connected',featureOutcome:'unconfirmed',...(voicemail?{mailboxStatus:'unknown',pinSent}:{})}};
      const finish=async()=>{if(op.ended)return;op.ended=true;clearTimeout(op.timer);second.off('destroy',finish);Object.assign(op.result,{monitoringEnded:true});if(this.active===op)this.active=null;await cleanup();};
      op.finish=finish;second.on('destroy',finish);this.active=op;this.operations.set(id,op);
      op.timer=setTimeout(()=>void finish(),this.timeout);op.timer.unref?.();return this.operation(id);
    }catch{await cleanup();return failure('session_failed');}finally{this.preparing=false;}
  }
  async attended(uri){
    if(this.active||this.preparing)return failure('busy');
    if(!this.dialog?.connected)return failure('no_active_dialog');
    const {srf,mediaServer,auth,extension}=this.options;
    if(!srf?.createUAC||!mediaServer?.createEndpoint)return failure('media_unavailable');
    this.preparing=true;
    let ep,second,held=false,suspended=false,cleaned=false;
    const cleanup=async(status)=>{
      if(cleaned)return;cleaned=true;
      for(const resource of [second,ep]){try{if(resource?.connected!==false)await resource?.destroy();}catch{}}
      if(held&&status!=='completed'&&this.dialog.connected&&!this.closed){try{await this.dialog.modify('unhold');}catch{}}
      if(suspended)await this.options.onSessionEnd?.({kind:'attended',status,closed:this.closed});
    };
    try{
      suspended=true;await this.options.onSessionStart?.({kind:'attended'});if(this.closed)throw Error('closed');
      await this.dialog.modify('hold');held=true;
      ep=await mediaServer.createEndpoint();
      if(this.closed)throw Error('closed');
      second=await this.invite(uri,{localSdp:ep.local.sdp,auth,callingNumber:extension,followRedirects:false});
      if(this.closed)throw Error('closed');
      await ep.modify(second.remote.sdp);
      const {callId,remoteTag,localTag}=second.sip;
      if(!callId||!remoteTag||!localTag)throw Error('missing_dialog_identifiers');
      return await this.refer(`${uri}?Replaces=${encodeURIComponent(`${callId};to-tag=${remoteTag};from-tag=${localTag}`)}`,cleanup);
    }catch{await cleanup('failed');return failure('attended_failed');}
    finally{this.preparing=false;}
  }
  async refer(uri,cleanup=async()=>{}){
    if(this.active)return failure('busy');
    if(!this.dialog?.connected)return failure('no_active_dialog');
    const id=randomUUID();const op={result:{ok:true,status:'pending',operationId:id,signaling:'sending'},cleanup};
    this.operations.set(id,op);this.active=op;
    while(this.operations.size>64)this.operations.delete(this.operations.keys().next().value);
    let accepted=false,queued=[];
    const finish=async(status,extra={})=>{
      if(op.ended)return;op.ended=true;clearTimeout(op.timer);this.dialog.off('notify',onNotify);
      Object.assign(op.result,{status,...extra});if(this.active===op)this.active=null;
      await cleanup(status);
    };
    const process=(req)=>{
      const event=String(req.get('Event')||'');
      if(!/^refer(?:;|$)/i.test(event)||!/^message\/sipfrag(?:;|$)/i.test(req.get('Content-Type')||''))return;
      const eventId=/;\s*id=([^;\s]+)/i.exec(event)?.[1];
      if(eventId&&op.cseq!==undefined&&eventId!==String(op.cseq))return;
      const code=Number(/^SIP\/2\.0\s+(\d{3})\b/.exec(req.body||'')?.[1]);
      if(code>=200&&code<=699)void finish(code<300?'completed':'failed',{notifyStatus:code});
    };
    const onNotify=(req,res)=>{res.send(200);if(accepted)process(req);else queued.push(req);};
    op.finish=finish;this.dialog.on('notify',onNotify);
    op.timer=setTimeout(()=>void finish('pending',{monitoringEnded:true,code:'completion_unconfirmed'}),this.timeout);op.timer.unref?.();
    try {
      const response=await this.dialog.request({method:'REFER',headers:{'Refer-To':`<${uri}>`,'Refer-Sub':'true'}});
      if(response.status<200||response.status>=300){await finish('failed',{sipStatus:response.status});return this.operation(id);}
      op.cseq=response.getParsedHeader?.('CSeq')?.seq;accepted=true;
      Object.assign(op.result,{signaling:'accepted',sipStatus:response.status});
      for(const req of queued)process(req);queued=[];
      return this.operation(id);
    }catch{await finish('failed',{code:'refer_failed'});return this.operation(id);}
  }
  async close(){this.closed=true;for(const cancel of this.inFlight)cancel();await Promise.all([...this.watches].map(op=>op.finish()));if(this.active)await this.active.finish('pending',{monitoringEnded:true,code:'call_closed'});}
}
module.exports={PbxTools};
