'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {runLiveCall}=require('../lib/live-call');
function fixture(){
 const sessions=[],waiting=new Map(),dialog=new EventEmitter();dialog.destroy=async()=>dialog.emit('destroy');
 const server={expectSession:key=>new Promise(resolve=>waiting.set(key,resolve)),cancelExpectation:key=>waiting.delete(key)};
 const endpoint={uuid:'fixture',api:async cmd=>cmd==='help'?'bidirectional stream stop_play':'+OK',forkAudioStop:async()=>{},destroy:async()=>{},forkAudioStart:async opts=>{
  const media=new EventEmitter();media.sent=[];media.sendPcm=b=>{media.sent.push(Buffer.from(b));media.emit('sent');};media.close=()=>media.emit('closed');sessions.push(media);waiting.get(opts.wsUrl.split('/').pop())(media);
 }};
 return {sessions,dialog,server,endpoint};
}
function environment(t){
 const keys=['GEMINI_API_KEY','LIVE_OPENCLAW_CONSULT'];const previous=keys.map(k=>process.env[k]);
 process.env.GEMINI_API_KEY='fixture-only';process.env.LIVE_OPENCLAW_CONSULT='true';
 t.after(()=>keys.forEach((k,i)=>previous[i]===undefined?delete process.env[k]:process.env[k]=previous[i]));
}
test('runLiveCall wires working cue into actual consultation and barge-in keeps it silent',async t=>{
 environment(t);const f=fixture();let callbacks,ready,release,signal;const started=new Promise(resolve=>ready=resolve),replies=[];
 t.mock.method(global,'fetch',(_,o)=>{signal=o.signal;return new Promise(resolve=>release=resolve);});
 const running=runLiveCall(f.endpoint,f.dialog,'fixture-call',{audioForkServer:f.server,messageStore:null,bridgeToken:'fixture-only',callerTier:'approved'},{connect:async o=>{callbacks=o.callbacks;return {sendClientContent:ready,sendRealtimeInput:()=>{},sendToolResponse:x=>replies.push(x),close:()=>{}};}});
 try{
  await started;callbacks.onmessage({toolCall:{functionCalls:[{id:'one',name:'query_openclaw',args:{prompt:'fixture'}}]}});
  await new Promise(resolve=>setTimeout(resolve,70));assert.ok(f.sessions[0].sent.length>0,'call emits cue while bridge waits');
  callbacks.onmessage({serverContent:{interrupted:true}});await new Promise(resolve=>setTimeout(resolve,70));
  assert.equal(signal.aborted,false);assert.equal(f.sessions.length,2);assert.equal(f.sessions[1].sent.length,0);
  release({ok:true,json:async()=>({success:true,response:'done'})});await new Promise(resolve=>setImmediate(resolve));assert.equal(replies.length,1);
 }finally{release?.({ok:false});await f.dialog.destroy();await running;}
});
test('runLiveCall creates and closes approved per-dialog PBX binding',async t=>{
 environment(t);const f=fixture();let ready,closed=false,seen,inputFrames=0;const started=new Promise(r=>ready=r),srf={};
 const running=runLiveCall(f.endpoint,f.dialog,'pbx-call',{audioForkServer:f.server,messageStore:null,bridgeToken:'fixture',callerTier:'approved',srf},{createPbxBinding:options=>{seen=options;return {declarations:[],execute:async()=>({}),close:async()=>{closed=true;}};},connect:async()=>({sendClientContent:ready,sendRealtimeInput:()=>inputFrames++,close:()=>{}})});
 try{await started;assert.equal(seen?.dialog,f.dialog);assert.equal(seen?.srf,srf);
 f.sessions[0].emit('pcm',Buffer.alloc(320));assert.equal(inputFrames,1);
 await seen.onSessionStart();f.sessions[0].emit('pcm',Buffer.alloc(320));assert.equal(inputFrames,1);
 await seen.onSessionEnd();f.sessions[1].emit('pcm',Buffer.alloc(320));assert.equal(inputFrames,2);
 }finally{await f.dialog.destroy();await running;}
 assert.ok(closed);
});
test('runLiveCall forwards server tool bindings and phoneContext to config and router',async t=>{
 environment(t);const f=fixture(),seen=[],marker={};let callbacks,config,ready;const started=new Promise(resolve=>ready=resolve);
 const phoneTools={declarations:[{name:'fixture_tool',description:'Fixture',parameters:{type:'OBJECT',properties:{}}}],execute:async(...args)=>{seen.push(args);return {success:true};}};
 const running=runLiveCall(f.endpoint,f.dialog,'bound-call',{audioForkServer:f.server,messageStore:null,bridgeToken:'fixture-only',callerTier:'approved',phoneTools,phoneContext:{marker}},{connect:async o=>{callbacks=o.callbacks;config=o.config;return {sendClientContent:ready,sendRealtimeInput:()=>{},sendToolResponse:()=>{},close:()=>{}};}});
 try{
  await started;assert.ok(config.tools.flatMap(x=>x.functionDeclarations).some(d=>d.name==='fixture_tool'));
  callbacks.onmessage({toolCall:{functionCalls:[{id:'one',name:'fixture_tool',args:{}}]}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(seen.length,1);assert.equal(seen[0][2].marker,marker);assert.equal(seen[0][2].callId,'bound-call');
 }finally{await f.dialog.destroy();await running;}
});

