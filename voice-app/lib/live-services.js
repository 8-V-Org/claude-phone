'use strict';
const fs=require('node:fs');
const path=require('node:path');
async function startLiveServices({srf,getMediaServer,audioForkServer,wsPort=3001,port=3000,env=process.env,token,messageStore,serverFactory,runCall}={}){
 const dir=env.PHONE_MESSAGES_DIR||'/app/messages';
 messageStore??=require('./message-store').getMessageStore();
 token??=fs.readFileSync(env.PHONE_BRIDGE_TOKEN_FILE,'utf8').trim();
 serverFactory??=require('./live-outbound').createLiveOutboundServer;
 runCall??=require('./live-call').runLiveCall;
 const approved=new Set((env.PHONE_ALLOWED_CALLERS||'').split(',').filter(Boolean));
 return serverFactory({srf,getMediaServer,token,messageStore,host:'127.0.0.1',port,env,allowPstn:env.PHONE_OUTBOUND_ALLOW_PSTN==='true',socketPath:path.join(dir,'phone-api.sock'),
  runCall:async(endpoint,dialog,callId,{to}={})=>runCall(endpoint,dialog,callId,{srf,mediaServer:await getMediaServer(),env,audioForkServer,wsPort,messageStore,bridgeToken:token,callerTier:approved.has(to)?'approved':'message'})
 });
}
module.exports={startLiveServices};
