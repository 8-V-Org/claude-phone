'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events');
test('index Live startup wires control API without loading batch HTTP APIs',async()=>{
 let args,srf,invites=0;const media={};
 class Srf extends EventEmitter{constructor(){super();srf=this;}connect(){setImmediate(()=>this.emit('connect',null,['udp/127.0.0.1:5060']));}invite(){invites++;}}
 class Mrf{connect(){return Promise.resolve(media);}}
 const imports=[];const fakeRequire=name=>{
  imports.push(name);
  const modules={'./lib/drachtio-byte-framing':{installDrachtioByteFraming(){}},'dotenv':{config(){}},'drachtio-srf':Srf,'drachtio-fsmrf':Mrf,'./lib/live-media':{LiveAudioForkServer:class {start(){}}},'./lib/sip-handler':{handleInvite:async()=>{},extractCallerId(){}},'./lib/device-registry':{getAllDevices:()=>({}),getRegistrationConfigs:()=>[]},'./lib/multi-registrar':class{registerAll(){}},'./lib/connection-retry':{connectWithRetry:fn=>fn()},'./lib/mrf-options':{localMrfOptions:x=>x},'./lib/live-services':{startLiveServices:async x=>{args=x;return {close(){}};}}};
  if(!(name in modules))throw Error('Unexpected import '+name);return modules[name];
 };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../index.js'),'utf8'),{require:fakeRequire,process:{env:{PHONE_VOICE_MODE:'live'},on(){}},console:{log(){},info(){},error(){}},setTimeout,setInterval});
 await new Promise(r=>setTimeout(r,20));
 assert.ok(args,'Live control API was not started');assert.equal(args.srf,srf);assert.equal(args.getMediaServer(),media);assert.equal(invites,1);assert.ok(!imports.includes('./lib/http-server'));
});
