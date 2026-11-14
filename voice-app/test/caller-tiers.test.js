'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCallGate}=require('../lib/call-gate');
test('SIP display names cannot spoof allowlisted caller or dialed extension',async()=>{
 const gate=createCallGate({sources:['192.0.2.1'],callers:['1001'],extension:'30910'});let tier,status;
 const r=req();r.get=n=>n==='From'?'"sip:1001@display.invalid" <sip:2002@pbx.invalid>':'"Normal" <sip:30910@pbx.invalid>';
 await gate(r,{send:s=>status=s},p=>tier=p.callerTier);assert.equal(status,undefined);assert.equal(tier,'message');
 r.get=n=>n==='From'?'"sip:2002@display.invalid" <sip:1001@pbx.invalid>;tag=abc':'"sip:30910@display.invalid" <sip:30911@pbx.invalid>';
 await gate(r,{send:s=>status=s},()=>assert.fail('wrong actual To URI'));assert.equal(status,403);
});
function req(caller='1001',source='192.0.2.1',extension='30910'){return {source_address:source,get:n=>n==='From'?`<sip:${caller}@pbx.invalid>`:`<sip:${extension}@pbx.invalid>`};}
test('trusted source unknown caller is admitted only as message tier',async()=>{
 const gate=createCallGate({sources:['192.0.2.1'],callers:['1001'],extension:'30910'});let tier,status;
 await gate(req('anonymous'),{send:s=>status=s},p=>{tier=p.callerTier;});
 assert.equal(status,undefined);assert.equal(tier,'message');
});
test('allowlisted caller is explicitly approved, spoofed source is rejected',async()=>{
 const gate=createCallGate({sources:['192.0.2.1'],callers:['1001'],extension:'30910'});let policy,status;
 await gate(req(),{send:s=>status=s},p=>{policy=p;});assert.equal(policy.callerTier,'approved');
 await gate(req('1001','192.0.2.2'),{send:s=>status=s},()=>assert.fail('untrusted caller admitted'));assert.equal(status,403);
});
test('wrong dialed extension is rejected and concurrent calls are busy',async()=>{
 const gate=createCallGate({sources:['192.0.2.1'],callers:['1001'],extension:'30910'});let status,release;
 await gate(req('1001','192.0.2.1','30911'),{send:s=>status=s},()=>assert.fail());assert.equal(status,403);
 const active=gate(req(),{send:s=>status=s},()=>new Promise(r=>release=r));
 await gate(req(),{send:s=>status=s},()=>assert.fail());assert.equal(status,486);release();await active;
});
