'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPbxBinding}=require('../lib/pbx-binding');
test('approved calls bind PBX with server credentials and dialCode overrides, never tool-controlled auth',async()=>{
 let options,closed=false;
 class Fake {constructor(o){options=o;}declarations(){return [{name:'transfer_blind'}];}execute(n,a){return {n,a};}close(){closed=true;}}
 const binding=createPbxBinding({callerTier:'approved',srf:{},endpoint:{},dialog:{},env:{SIP_REGISTRAR:'example.test',SIP_EXTENSION:'30910',SIP_AUTH_ID:'private-id',SIP_AUTH_PASSWORD:'private-secret'},readConfig:()=>({dialCodes:{pickup:'*20*{target}'}}),PbxClass:Fake});
 assert.equal(options.registrar,'example.test');assert.equal(options.auth.username,'private-id');assert.equal(options.allowPstn,false);assert.equal(options.dialCodes.pickup,'*20*{target}');
 assert.equal(binding.declarations[0].name,'transfer_blind');assert.deepEqual(await binding.execute('transfer_blind',{destination:'30911'}),{n:'transfer_blind',a:{destination:'30911'}});await binding.close();assert.ok(closed);
});
test('unknown caller never reads protected config or receives PBX tools',()=>{
 const binding=createPbxBinding({callerTier:'message',readConfig:()=>{throw Error('must not read');}});assert.equal(binding,null);
});
test('invalid protected dialCodes fails closed rather than silently overriding policy',()=>{
 assert.throws(()=>createPbxBinding({callerTier:'approved',readConfig:()=>({dialCodes:[]})}),/dialCodes/);
});

test('PSTN flag from the voice environment enables outbound transfers without a destination allowlist',async()=>{
 let options;
 class Fake {constructor(o){options=o;}declarations(){return [];}execute(){}close(){}}
 createPbxBinding({callerTier:'approved',srf:{},endpoint:{},dialog:{},env:{SIP_REGISTRAR:'example.test',SIP_EXTENSION:'30910',SIP_AUTH_ID:'private-id',SIP_AUTH_PASSWORD:'private-secret',PHONE_OUTBOUND_ALLOW_PSTN:'true'},readConfig:()=>({}),PbxClass:Fake});
 assert.equal(options.allowPstn,true);
 assert.equal(options.authorizePstn('+16174449080'),true);
 assert.equal(options.authorizePstn('30911'),true);
 assert.equal(options.authorizePstn('sip:evil'),false);
});
