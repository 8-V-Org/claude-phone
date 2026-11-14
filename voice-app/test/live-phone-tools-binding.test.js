'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {LiveToolRouter,buildLiveConfig}=require('../lib/live-tools');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const declaration={name:'fixture_call_tool',description:'Fixture bound capability',parameters:{type:'OBJECT',properties:{}}};
const toolNames=config=>(config.tools||[]).flatMap(x=>x.functionDeclarations.map(d=>d.name));
test('unknown callers cannot declare or execute bound tools and undeclared names stay rejected',async()=>{
 let executions=0;const phoneTools={declarations:[declaration],execute:async()=>{executions++;return {success:true};}},replies=[];
 assert.deepEqual(toolNames(buildLiveConfig({callerTier:'message',phoneTools})),[]);
 const r=new LiveToolRouter({callerTier:'message',phoneTools,send:x=>replies.push(x)});
 r.handle([{id:'forged',name:declaration.name,args:{}}]);await flush();assert.equal(executions,0);assert.ok(replies[0].functionResponses[0].response.error);r.close();
 const approved=new LiveToolRouter({callerTier:'approved',phoneTools,send:x=>replies.push(x)});
 approved.handle([{id:'undeclared',name:'other_tool',args:{}}]);await flush();assert.equal(executions,0);approved.close();
});
test('reserved declarations cannot replace core tools or create duplicate names',()=>{
 const phoneTools={declarations:[declaration,declaration,{name:'query_openclaw'},{name:'record_message'},{name:'post_to_main_chat'},{name:'invalid name'}],execute:async()=>({})};
 assert.deepEqual(toolNames(buildLiveConfig({callerTier:'approved',phoneTools})).sort(),['fixture_call_tool','post_to_main_chat','query_openclaw']);
});
test('bound tool results deduplicate and failures never expose exception content',async()=>{
 const replies=[];let executions=0;const phoneTools={declarations:[declaration],execute:async()=>{executions++;return {success:true};}};
 const r=new LiveToolRouter({callerTier:'approved',phoneTools,send:x=>replies.push(x)});
 const fc={id:'once',name:declaration.name,args:{}};
 r.handle([fc]);await flush();r.handle([fc]);assert.equal(executions,1);assert.deepEqual(replies[0],replies[1]);
 phoneTools.execute=()=>{throw Error('private synthetic exception');};r.handle([{...fc,id:'fail'}]);await flush();assert.match(replies.at(-1).functionResponses[0].response.error,/unconfirmed|no action completion/i);assert.doesNotMatch(JSON.stringify(replies),/private synthetic/);r.close();
});

test('approved caller can use a declared bound tool with authoritative cancellable context',async()=>{
 const replies=[],seen=[],marker={};let resolveTool;
 const phoneTools={declarations:[declaration],execute:(...args)=>{seen.push(args);return new Promise(resolve=>resolveTool=resolve);}};
 const config=buildLiveConfig({callerTier:'approved',phoneTools});assert.ok(toolNames(config).includes(declaration.name));
 const r=new LiveToolRouter({callerTier:'approved',phoneTools,phoneContext:{marker,callId:'forged',callerTier:'message',signal:'forged'},callId:'verified',send:x=>replies.push(x)});
 try{
  r.handle([{id:'tool',name:declaration.name,args:{value:1}}]);await flush();
  assert.equal(seen.length,1);assert.equal(seen[0][0],declaration.name);assert.deepEqual(seen[0][1],{value:1});
  assert.equal(seen[0][2].marker,marker);assert.equal(seen[0][2].callId,'verified');assert.equal(seen[0][2].callerTier,'approved');assert.equal(seen[0][2].signal.aborted,false);
  r.cancel(['tool']);assert.equal(seen[0][2].signal.aborted,true);resolveTool({success:true});await flush();assert.equal(replies.length,0);
 }finally{r.close();resolveTool?.({success:true});}
});
