'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {runLiveCall}=require('../lib/live-call');
function fixture(){const d=new EventEmitter();d.destroy=async()=>d.emit('destroy');const pending=new Map();const server={expectSession:key=>new Promise(r=>pending.set(key,r)),cancelExpectation:()=>{}};const ep={uuid:'tier-call',api:async()=>'+OK bidirectional stream stop_play',forkAudioStop:async()=>{},forkAudioStart:async o=>{const m=new EventEmitter();m.close=()=>{};m.sendPcm=()=>{};pending.get(o.wsUrl.split('/').pop())(m);},destroy:async()=>{}};return {d,ep,server};}
for(const tier of ['approved','message'])test('Live session receives server-selected '+tier+' tier',async t=>{
 const f=fixture();const old=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-only';
 t.after(()=>old===undefined?delete process.env.GEMINI_API_KEY:process.env.GEMINI_API_KEY=old);
 // No bridge-token file read in tests: inject token through call options.
 let config,greeting;const connect=async o=>{config=o.config;return {sendClientContent:x=>{greeting=x;setImmediate(()=>f.d.emit('destroy'));},close:()=>{}};};
 await runLiveCall(f.ep,f.d,'tier-call',{audioForkServer:f.server,callerTier:tier,bridgeToken:'test-only',messageStore:{save:async()=>({id:'test'})}},{connect});
 const names=(config.tools||[]).flatMap(x=>x.functionDeclarations.map(f=>f.name));
 assert.equal(names.includes('query_openclaw'),tier==='approved');assert.ok(names.includes('record_message'));
 assert.match(greeting.turns[0].parts[0].text,tier==='approved'?/help/i:/message/i);
});
