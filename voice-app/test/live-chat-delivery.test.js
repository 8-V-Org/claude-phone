'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildLiveConfig,LiveToolRouter}=require('../lib/live-tools');
const flush=()=>new Promise(r=>setImmediate(r));
const fc={id:'operation-one',name:'post_to_main_chat',args:{message:'Please keep this update.'}};
test('unknown caller cannot declare or forge chat delivery, including through bound phone tools',async()=>{
 let actions=0;const replies=[];
 const phoneTools={declarations:[{name:fc.name}],execute:async()=>actions++};
 const config=buildLiveConfig({callerTier:'message',canTakeMessages:true,phoneTools});
 assert.deepEqual(config.tools.flatMap(t=>t.functionDeclarations.map(d=>d.name)),['record_message']);
 const router=new LiveToolRouter({callerTier:'message',phoneTools,send:r=>replies.push(r),fetchImpl:async()=>actions++});
 try{router.handle([fc]);await flush();assert.equal(actions,0);assert.equal(replies[0].functionResponses[0].response.delivered,false);}
 finally{router.close();}
});
test('auth rejection, ambiguous success, invalid JSON, and network loss never confirm or retry delivery',async()=>{
 for(const fetchImpl of [async()=>({ok:false,status:401}),async()=>({ok:true,status:200,json:async()=>({delivered:true})}),async()=>({ok:true,json:async()=>({success:true})}),async()=>({ok:true,json:async()=>{throw Error('invalid JSON');}}),async()=>{throw Error('network loss');}]){
  let calls=0;const replies=[];
  const router=new LiveToolRouter({callerTier:'approved',send:r=>replies.push(r),fetchImpl:(...a)=>{calls++;return fetchImpl(...a);}});
  try{router.handle([fc]);await flush();router.handle([fc]);await flush();assert.equal(calls,1);assert.equal(replies.length,2);for(const reply of replies)assert.equal(reply.functionResponses[0].response.delivered,false);}
  finally{router.close();}
 }
});
test('invalid chat messages never reach bridge and cancellation suppresses late delivery confirmation',async()=>{
 let calls=0,release,signal;const replies=[];
 const router=new LiveToolRouter({callerTier:'approved',send:r=>replies.push(r),fetchImpl:(_,o)=>{calls++;signal=o.signal;return new Promise(r=>release=r);}});
 try{
  for(const message of [undefined,42,'','   ','x'.repeat(8001)])router.handle([{...fc,args:{message}}]);
  assert.equal(calls,0);replies.length=0;router.handle([fc]);router.cancel([fc.id]);await flush();
  assert.equal(signal.aborted,true);assert.equal(router.pending.size,0);
  release({ok:true,json:async()=>({delivered:true})});await flush();router.handle([fc]);assert.equal(replies.length,0);assert.equal(calls,1);
 }finally{router.close();}
});
test('chat deadline reports unconfirmed without upstream cooperation and caches failure without retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let release,signal,fetches=0;const replies=[];
 const router=new LiveToolRouter({callerTier:'approved',send:r=>replies.push(r),fetchImpl:(_,o)=>{fetches++;signal=o.signal;return new Promise(r=>release=r);}});
 try{
  router.handle([fc]);t.mock.timers.tick(125000);await flush();
  assert.equal(signal.aborted,true);assert.equal(replies[0]?.functionResponses[0].response.delivered,false);
  assert.match(replies[0].functionResponses[0].response.error,/unconfirmed/);
  assert.equal(router.pending.size,0);router.handle([fc]);await flush();assert.equal(fetches,1);
  release({ok:true,json:async()=>({delivered:true})});await flush();
  assert.equal(replies.length,2);assert.equal(replies[1].functionResponses[0].response.delivered,false);
 }finally{router.close();}
});
test('approved chat tool declares message only and posts authenticated server-owned IDs directly once',async()=>{
 const config=buildLiveConfig({callerTier:'approved',consult:false});
 const declaration=config.tools?.flatMap(t=>t.functionDeclarations).find(d=>d.name===fc.name);
 assert.deepEqual(declaration?.parameters,{type:'OBJECT',properties:{message:{type:'STRING'}},required:['message']});
 assert.match(config.systemInstruction,/post_to_main_chat/);
 const requests=[],replies=[];
 const router=new LiveToolRouter({callerTier:'approved',consult:false,callId:'server-call',token:'fixture-token',send:r=>replies.push(r),fetchImpl:async(url,options)=>{
  requests.push({url,options});return {ok:true,status:200,json:async()=>({delivered:true,proof:{messageId:1,role:'user',exactMatch:true}})};
 }});
 try{
  router.handle([fc,fc]);await flush();router.handle([fc]);await flush();
  assert.equal(requests.length,1);assert.equal(requests[0].url,'http://127.0.0.1:3333/deliver-chat');
  assert.equal(requests[0].options.method,'POST');assert.equal(requests[0].options.redirect,'error');
  assert.equal(requests[0].options.headers.Authorization,'Bearer fixture-token');
  assert.deepEqual(JSON.parse(requests[0].options.body),{callId:'server-call',operationId:fc.id,message:fc.args.message});
  assert.deepEqual(replies[0].functionResponses[0].response,{delivered:true});
 }finally{router.close();}
});
