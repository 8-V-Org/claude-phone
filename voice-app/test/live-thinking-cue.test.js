'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {LivePlayout}=require('../lib/live-media');
const {LiveToolRouter,routeLiveMessage}=require('../lib/live-tools');
const {ThinkingCue}=require('../lib/thinking-cue');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('barge-in silences cue synchronously, resets media, and leaves consultation running',async()=>{
 let resolveFetch,signal,resets=0;const sent=[],replies=[];
 const media={sendPcm:b=>sent.push(b)};
 const p=new LivePlayout({resetMedia:async()=>{resets++;return media;},onFault:e=>{throw e;}});clearInterval(p.timer);p.media=media;
 const r=new LiveToolRouter({callerTier:'approved',cue:p.cue,send:x=>replies.push(x),fetchImpl:(_,o)=>{signal=o.signal;return new Promise(resolve=>resolveFetch=resolve);}});
 try{
  r.handle([{id:'consult',name:'query_openclaw',args:{prompt:'test'}}]);p.tick();
  routeLiveMessage({serverContent:{interrupted:true}},{playout:p,tools:r});
  assert.equal(p.cue.active,false);assert.equal(signal.aborted,false);
  await p.chain;p.tick();assert.equal(sent.length,1);assert.equal(resets,1);
  resolveFetch({ok:true,json:async()=>({success:true,response:'done'})});await flush();assert.equal(replies.length,1);
 }finally{r.close();p.close();resolveFetch?.({ok:false});}
});

test('cue stops immediately on tool cancellation even if upstream ignores abort',async()=>{
 const cue=new ThinkingCue();let resolveFetch,signal;const replies=[];
 const r=new LiveToolRouter({callerTier:'approved',cue,send:x=>replies.push(x),fetchImpl:(_,o)=>{signal=o.signal;return new Promise(resolve=>resolveFetch=resolve);}});
 try{
  r.handle([{id:'cancel',name:'query_openclaw',args:{prompt:'test'}}]);assert.equal(cue.active,true);
  r.cancel(['cancel']);assert.equal(cue.active,false);assert.equal(signal.aborted,true);
  resolveFetch({ok:true,json:async()=>({success:true,response:'late'})});await flush();assert.equal(replies.length,0);
 }finally{r.close();resolveFetch?.({ok:false});}
});

test('timeout stops cue and cannot confirm a late result from abort-ignoring upstream',async t=>{
 const cue=new ThinkingCue(),replies=[];let resolveFetch,expire;const schedule=global.setTimeout;
 t.mock.method(global,'setTimeout',(fn,ms)=>{expire=fn;return schedule(fn,ms);});
 const r=new LiveToolRouter({callerTier:'approved',cue,send:x=>replies.push(x),fetchImpl:()=>new Promise(resolve=>resolveFetch=resolve)});
 try{
  r.handle([{id:'timeout',name:'query_openclaw',args:{prompt:'test'}}]);expire();assert.equal(cue.active,false);
  resolveFetch({ok:true,json:async()=>({success:true,response:'late success'})});await flush();
  assert.ok(replies[0].functionResponses[0].response.error);assert.equal(replies[0].functionResponses[0].response.output,undefined);
 }finally{r.close();resolveFetch?.({ok:false});}
});

test('consult emits bounded soft local PCM without blocking fetch, then stops before reply',async()=>{
 const sent=[],replies=[];let resolveFetch,started=false;
 const p=new LivePlayout({onFault:e=>{throw e;}});clearInterval(p.timer);p.media={sendPcm:b=>sent.push(Buffer.from(b))};
 const r=new LiveToolRouter({callerTier:'approved',cue:p.cue,send:x=>replies.push(x),fetchImpl:()=>{started=true;return new Promise(resolve=>resolveFetch=resolve);}});
 try{
  r.handle([{id:'consult',name:'query_openclaw',args:{prompt:'test'}}]);
  assert.equal(started,true,'fetch starts immediately, without waiting for cue');
  p.tick();assert.equal(sent.length,1,'consultation has an audible working cue');
  assert.equal(sent[0].length,960);let peak=0;for(let i=0;i<960;i+=2)peak=Math.max(peak,Math.abs(sent[0].readInt16LE(i)));
  assert.ok(peak>0&&peak<=600,'soft 24kHz signed 16-bit PCM');assert.equal(p.bytes,0,'cue never enters speech queue');
  resolveFetch({ok:true,json:async()=>({success:true,response:'done'})});await flush();
  p.tick();assert.equal(sent.length,1);assert.equal(replies.length,1);
 }finally{r.close();p.close();}
});
