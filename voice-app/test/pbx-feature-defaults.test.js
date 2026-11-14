'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PbxTools}=require('../lib/pbx-tools');
const {EventEmitter}=require('node:events');
function resource(){const d=new EventEmitter();Object.assign(d,{connected:true,local:{sdp:'v=0\r\na=sendrecv\r\n'},remote:{sdp:'v=0'},sip:{callId:'c',localTag:'l',remoteTag:'r'},requests:[]});d.request=async o=>{d.requests.push(o);return {status:202};};d.modify=async()=>{};d.destroy=async()=>{d.connected=false;};d.bridge=async()=>{};return d;}
test('explicit declarations execute real feature SIP routes and retain pbx aliases',async()=>{
 const d=resource(),legs=[];const p=new PbxTools({callerTier:'approved',dialog:d,registrar:'pbx.invalid',mediaServer:{createEndpoint:async()=>resource()},srf:{createUAC:async(u,o)=>{legs.push([u,o]);return resource();}}});
 const names=p.declarations().map(x=>x.name);
 for(const name of ['transfer_blind','transfer_attended','call_park','call_unpark','call_pickup','presence_set','presence_watch','voicemail_leave','voicemail_check','pbx_blind_transfer','pbx_attended_transfer','pbx_session_action','pbx_presence_watch','pbx_voicemail_check'])assert.ok(names.includes(name),name);
 for(const [name,args,uri] of [['call_unpark',{orbit:'2',ext:'30911'},'*1230911'],['call_pickup',{},'*20*'],['presence_set',{state:'dnd'},'*32'],['voicemail_leave',{ext:'30911'},'*430911'],['voicemail_check',{},'999']]){
  const r=await p.execute(name,args);assert.equal(r.ok,true,name);assert.equal(legs.at(-1)[0],`sip:${uri}@pbx.invalid`);await p.active.finish();
 }
 const park=await p.execute('call_park',{orbit:'3'});assert.equal(park.ok,true);assert.equal(d.requests.at(-1).headers['Refer-To'],'<sip:*03@pbx.invalid>');await p.active.finish('failed');
 assert.equal((await p.execute('transfer_blind',{destination:'+16174449080'})).code,'destination_denied');
 assert.equal((await p.execute('transfer_blind',{destination:'30911'})).ok,true);await p.active.finish('failed');
 assert.equal((await p.execute('transfer_attended',{destination:'30911'})).ok,true);await p.active.finish('failed');
 const watch=await p.execute('presence_watch',{destination:'30911',seconds:1});assert.equal(watch.ok,true);assert.equal(legs.at(-1)[1].method,'SUBSCRIBE');await p.close();
});
test('media session hooks suspend before bridge and resume exactly once after cleanup, including failures',async()=>{
 for(const fail of [false,true]){
  const events=[],ep=resource(),second=resource(),caller=resource();
  ep.bridge=async()=>{events.push('bridge');if(fail)throw Error('bridge');};
  ep.unbridge=async()=>events.push('unbridge');
  ep.destroy=async()=>events.push('destroy');
  const p=new PbxTools({callerTier:'approved',registrar:'pbx.invalid',endpoint:caller,mediaServer:{createEndpoint:async()=>ep},srf:{createUAC:async()=>second},onSessionStart:async()=>events.push('suspend'),onSessionEnd:async()=>events.push('resume')});
  const r=await p.execute('call_pickup',{});
  assert.equal(r.ok,!fail);assert.equal(events[0],'suspend');assert.ok(events.indexOf('bridge')>events.indexOf('suspend'));
  if(!fail){assert.ok(!events.includes('resume'));await p.active.finish();}
  await p.close();assert.equal(events.filter(x=>x==='resume').length,1);assert.ok(events.indexOf('resume')>events.indexOf('destroy'));
 }
});
test('failed suspension fails closed but still invokes recovery hook without dialing',async()=>{
 let dialed=false,resumed=0;const p=new PbxTools({callerTier:'approved',registrar:'pbx.invalid',endpoint:resource(),mediaServer:{createEndpoint:async()=>resource()},srf:{createUAC:async()=>{dialed=true;return resource();}},onSessionStart:async()=>{throw Error('suspension failed');},onSessionEnd:async()=>resumed++});
 assert.equal((await p.execute('call_pickup',{})).ok,false);assert.equal(dialed,false);assert.equal(resumed,1);await p.close();
});
test('PIN transmission requires explicit logging-safe opt in before reading secrets or dialing',async()=>{
 let dialed=false;const p=new PbxTools({callerTier:'approved',registrar:'pbx.invalid',voicemailPinPath:'/nonexistent/not-read',mediaServer:{createEndpoint:async()=>resource()},srf:{createUAC:async()=>{dialed=true;return resource();}}});
 const r=await p.execute('voicemail_check',{});assert.equal(r.code,'private_dtmf_unavailable');assert.equal(dialed,false);await p.close();
});
test('attended transfer invokes media hooks before hold and after failure unhold',async()=>{
 const events=[],d=resource();d.modify=async v=>events.push(v);
 const p=new PbxTools({callerTier:'approved',dialog:d,registrar:'pbx.invalid',mediaServer:{createEndpoint:async()=>resource()},srf:{createUAC:async()=>{throw Error('unreachable');}},onSessionStart:async()=>events.push('suspend'),onSessionEnd:async()=>events.push('resume')});
 assert.equal((await p.execute('transfer_attended',{destination:'30911'})).ok,false);assert.deepEqual(events,['suspend','hold','unhold','resume']);await p.close();
});
test('owner feature defaults validate orbit, optional pickup/unpark extension and presence state',()=>{
 const p=new PbxTools();
 for(const [args,expected] of [
  [{action:'park',orbit:'1'},'*01'],[{action:'park',target:'9'},'*09'],
  [{action:'unpark',orbit:2},'*12'],[{action:'unpark',orbit:'2',ext:'30911'},'*1230911'],
  [{action:'pickup'},'*20*'],[{action:'pickup',ext:'30911'},'*20*30911'],
  ...['available','away','dnd','custom1','custom2'].map((state,i)=>[{action:'presence',state},`*3${i}`]),
  [{action:'voicemail_leave',ext:'30911'},'*430911'],[{action:'voicemail_check'},'999'],[{action:'voicemail'},'999']
 ])assert.equal(p.featureCode(args),expected);
 for(const args of [{action:'park',orbit:'0'},{action:'park',orbit:'10'},{action:'unpark',orbit:'2',ext:'x'},{action:'presence',state:'busy'},{action:'voicemail_leave'}])assert.throws(()=>p.featureCode(args));
 const custom=new PbxTools({dialCodes:{park:'*80{target}',unpark:'*90{orbit}[{ext}]',pickup:'*55',presence:{away:'*88'},voicemail:'777'}});
 assert.equal(custom.featureCode({action:'park',target:'2'}),'*802');
 assert.equal(custom.featureCode({action:'unpark',orbit:3}),'*903');
 assert.equal(custom.featureCode({action:'pickup'}),'*55');
 assert.equal(custom.featureCode({action:'presence',state:'away'}),'*88');
 assert.equal(custom.featureCode({action:'voicemail_check'}),'777');
 assert.throws(()=>custom.featureCode({action:'presence',state:'available'}));
});
