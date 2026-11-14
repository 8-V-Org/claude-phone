'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const live=require('../lib/live-call');
test('SIP admission passes approved or message tier into Live and denies unknown callers in batch',async t=>{
 const keys=['PHONE_SIP_SOURCES','PHONE_ALLOWED_CALLERS','SIP_EXTENSION','PHONE_VOICE_MODE'];const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const original=live.runLiveCall;
 Object.assign(process.env,{PHONE_SIP_SOURCES:'192.0.2.1',PHONE_ALLOWED_CALLERS:'1001',SIP_EXTENSION:'30910',PHONE_VOICE_MODE:'live'});
 delete require.cache[require.resolve('../lib/sip-handler')];const {handleInvite,extractCallerId,extractDialedExtension}=require('../lib/sip-handler');
 assert.equal(extractCallerId({get:()=> '"sip:1001@display" <sip:2002@pbx>'}),'2002');
 assert.equal(extractDialedExtension({get:()=> '"sip:30911@display" <sip:30910@pbx>'}),'30910');
 t.after(()=>{live.runLiveCall=original;for(const k of keys)before[k]===undefined?delete process.env[k]:process.env[k]=before[k];});
 let tier,connections=0;live.runLiveCall=async(e,d,id,o)=>tier=o.callerTier;
 const options={mediaServer:{connectCaller:async()=>{connections++;const dialog=new EventEmitter();dialog.destroy=async()=>{};return {endpoint:{uuid:'id',destroy:async()=>{}},dialog};}}};
 const req=caller=>({source_address:'192.0.2.1',body:'v=0\r\n',get:n=>n==='From'?`sip:${caller}@example`:'sip:30910@example'});let code;const res={send:c=>code=c};
 await handleInvite(req('1001'),res,options);assert.equal(tier,'approved');
 await handleInvite(req('1002'),res,options);assert.equal(tier,'message');assert.equal(connections,2);
 process.env.PHONE_VOICE_MODE='batch';await handleInvite(req('1002'),res,options).catch(()=>{});assert.equal(code,403);assert.equal(connections,2);
});
