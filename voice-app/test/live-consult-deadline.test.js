'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {LiveToolRouter}=require('../lib/live-tools');
const {ThinkingCue}=require('../lib/thinking-cue');
const flush=()=>new Promise(r=>setImmediate(r));
test('consult waits beyond 25 seconds and returns final response before 125-second deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const replies=[],cue=new ThinkingCue();let resolveFetch,signal;
 const router=new LiveToolRouter({callerTier:'approved',cue,send:r=>replies.push(r),fetchImpl:(_,o)=>{signal=o.signal;return new Promise(r=>resolveFetch=r);}});
 try{
  router.handle([{id:'long',name:'query_openclaw',args:{prompt:'Please research this'}}]);
  t.mock.timers.tick(119999);await flush();
  assert.equal(signal.aborted,false);assert.equal(cue.active,true);assert.equal(replies.length,0);
  resolveFetch({ok:true,json:async()=>({success:true,response:'Final researched answer'})});await flush();
  assert.deepEqual(replies[0].functionResponses[0].response,{output:'Final researched answer',truncated:false});
  assert.equal(cue.active,false);
 }finally{router.close();}
});
test('125-second deadline settles unconfirmed even when upstream ignores abort forever',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const replies=[],cue=new ThinkingCue();let resolveFetch,signal;
 const router=new LiveToolRouter({callerTier:'approved',cue,send:r=>replies.push(r),fetchImpl:(_,o)=>{signal=o.signal;return new Promise(r=>resolveFetch=r);}});
 const fc={id:'deadline',name:'query_openclaw',args:{prompt:'test'}};
 try{
  router.handle([fc]);t.mock.timers.tick(124999);await flush();assert.equal(signal.aborted,false);
  t.mock.timers.tick(1);await flush();assert.equal(signal.aborted,true);assert.equal(cue.active,false);
  assert.match(replies[0]?.functionResponses[0].response.error||'',/unconfirmed|no action completion is confirmed/);
  assert.equal(router.pending.size,0);
  resolveFetch({ok:true,json:async()=>({success:true,response:'late success'})});await flush();
  router.handle([fc]);await flush();
  assert.equal(replies.length,2);assert.equal(replies[1].functionResponses[0].response.output,undefined);
 }finally{router.close();}
});
