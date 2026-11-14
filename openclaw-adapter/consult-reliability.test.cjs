'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createBridge}=require('./server.cjs');
const {LiveToolRouter,buildLiveConfig}=require('../voice-app/lib/live-tools');
const {greetingPrompt}=require('../voice-app/lib/receptionist');
const flush=()=>new Promise(r=>setImmediate(r));
test('coordinated default deadlines and OpenClaw identification',()=>{
 const s=createBridge({gatewayUrl:'http://127.0.0.1:18789',gatewayToken:'test',bridgeToken:'test-token-not-a-real-secret'});
 assert.equal(s.requestTimeout,105000);
 const r=new LiveToolRouter();assert.equal(r.timeoutMs,100000);r.close();
 assert.match(greetingPrompt({}, {tier:'approved'}),/OpenClaw, your AI assistant/);
 const c=buildLiveConfig({tier:'approved',receptionist:{businessName:'',humanContact:'',faq:[]}});
 assert.match(c.systemInstruction,/each substantive request or follow-up/);
 assert.match(c.systemInstruction,/available system RAM/);
});
test('bridge reports typed timeout without leaking upstream details',async t=>{
 const s=createBridge({gatewayUrl:'http://127.0.0.1:18789',gatewayToken:'test',bridgeToken:'test-token-not-a-real-secret',timeoutMs:10,fetchImpl:(_,o)=>new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}))});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{s.closeAllConnections();s.close(r);}));
 const response=await fetch('http://127.0.0.1:'+s.address().port+'/ask',{method:'POST',headers:{Authorization:'Bearer test-token-not-a-real-secret','Content-Type':'application/json'},body:JSON.stringify({callId:'timeout',prompt:'test'})});
 assert.equal(response.status,504);assert.equal((await response.json()).code,'CONSULT_TIMEOUT');
});
test('approved failure is audible, not retried, and a fresh follow-up works',async()=>{
 let requests=0;const replies=[];
 const r=new LiveToolRouter({tier:'approved',send:x=>replies.push(x),fetchImpl:async()=>{requests++;return requests===1?{ok:false,status:504,json:async()=>({success:false,code:'CONSULT_TIMEOUT'})}:{ok:true,json:async()=>({success:true,response:'follow-up answer'})};}});
 r.handle([{id:'one',name:'query_openclaw',args:{prompt:'hostname'}}]);await flush();
 assert.equal(requests,1);assert.equal(replies[0].functionResponses[0].scheduling,'INTERRUPT');
 assert.equal(replies[0].functionResponses[0].response.code,'CONSULT_TIMEOUT');
 assert.match(replies[0].functionResponses[0].response.error,/do not automatically retry actions/);
 r.handle([{id:'two',name:'query_openclaw',args:{prompt:'available RAM'}}]);await flush();
 assert.equal(requests,2);assert.equal(replies[1].functionResponses[0].response.output,'follow-up answer');r.close();
});
test('voice outer deadline reports timeout and releases pending consultation',async()=>{
 const replies=[];const r=new LiveToolRouter({tier:'approved',timeoutMs:5,send:x=>replies.push(x),fetchImpl:(_,o)=>new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}))});
 r.handle([{id:'one',name:'query_openclaw',args:{prompt:'test'}}]);await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(replies[0].functionResponses[0].response.code,'CONSULT_TIMEOUT');assert.equal(r.pending.size,0);r.close();
});
