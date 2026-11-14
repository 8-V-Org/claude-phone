'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildLiveConfig,LiveToolRouter}=require('../lib/live-tools');
const flush=()=>new Promise(r=>setImmediate(r));
test('record_message persists confirmed consent, deduplicates and reports underlying failures privately',async()=>{
 const replies=[],errors=[];let saves=0;
 const store={save:async(data)=>{saves++;assert.equal(data.consent,true);return {id:'saved-id',path:'/private/saved-id.json'};}};
 const r=new LiveToolRouter({callerTier:'message',messageStore:store,callId:'call',send:x=>replies.push(x),logger:{error:(...x)=>errors.push(x)}});
 const fc={id:'save',name:'record_message',args:{name:'Test',callback:'test callback',reason:'test reason',consent:true}};
 r.handle([fc]);await flush();r.handle([fc]);assert.equal(saves,1);assert.equal(replies[0].functionResponses[0].response.recorded,true);
 assert.equal(replies[0].functionResponses[0].response.path,undefined);
 store.save=async()=>{throw Object.assign(Error('storage permission denied'),{code:'EACCES'});};
 r.handle([{...fc,id:'fail'}]);await flush();
 assert.equal(replies.at(-1).functionResponses[0].response.recorded,false);assert.equal(replies.at(-1).functionResponses[0].response.code,'EACCES');assert.ok(errors.length);r.close();
});
test('record_message rejects missing consent before calling store',async()=>{
 let saves=0;const replies=[];const r=new LiveToolRouter({messageStore:{save:async()=>saves++},send:x=>replies.push(x)});
 r.handle([{id:'no',name:'record_message',args:{name:'n',callback:'c',reason:'r',consent:false}}]);await flush();assert.equal(saves,0);assert.equal(replies[0].functionResponses[0].response.recorded,false);r.close();
});
test('approved consult passes server-verified authority context to existing bridge',async()=>{
 let payload;const r=new LiveToolRouter({callerTier:'approved',callId:'approved-call',send:()=>{},fetchImpl:async(_,o)=>{payload=JSON.parse(o.body);return {ok:true,json:async()=>({success:true,response:'ok'})};}});
 r.handle([{id:'authority',name:'query_openclaw',args:{prompt:'Check the system'}}]);await flush();assert.match(payload.prompt,/server-verified pre-approved caller/i);assert.match(payload.prompt,/authenticated Hermes web GUI/);assert.match(payload.prompt,/Check the system/);r.close();
});
test('phone assistant identifies itself as Hermes for both caller tiers',()=>{
 for(const callerTier of ['approved','message']){
  const c=buildLiveConfig({callerTier});
  assert.match(c.systemInstruction,/You are Hermes/);
  assert.match(c.systemInstruction,/Introduce yourself as Hermes/);
 }
});
const names=c=>(c.tools||[]).flatMap(t=>t.functionDeclarations.map(f=>f.name));
test('approved Live caller gets full conversation consult without explicit magic phrase',()=>{
 const c=buildLiveConfig({callerTier:'approved',consult:true,canTakeMessages:true});
 assert.ok(names(c).includes('query_openclaw'));
 assert.doesNotMatch(c.systemInstruction,/isolated|read.only|explicitly asks to consult/i);
 assert.match(c.systemInstruction,/every substantive|all substantive/i);
});
test('unknown caller has only record_message, even when global consult is true',()=>{
 const c=buildLiveConfig({callerTier:'message',consult:true,canTakeMessages:true});
 assert.deepEqual(names(c),['record_message']);assert.match(c.systemInstruction,/consent/i);
 assert.ok(!names(buildLiveConfig({consult:true,canTakeMessages:true})).includes('query_openclaw'));
});
test('unknown tool router rejects forged consult call without touching bridge',async()=>{
 const replies=[];let fetches=0;
 const r=new LiveToolRouter({callerTier:'message',consult:true,send:x=>replies.push(x),fetchImpl:async()=>{fetches++;}});
 r.handle([{id:'x',name:'query_openclaw',args:{prompt:'hello'}}]);await flush();
 assert.equal(fetches,0);assert.ok(replies[0].functionResponses[0].response.error);r.close();
});
