'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {runLiveCall}=require('../lib/live-call');
test('real Live wrapper never counts padding/cue or rejected frames as post-save speech',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'playback-observation-')),old={key:process.env.GEMINI_API_KEY,consult:process.env.LIVE_OPENCLAW_CONSULT,messages:process.env.PHONE_MESSAGES_DIR},oldInfo=console.info,events=[];
 process.env.GEMINI_API_KEY='test-only';process.env.LIVE_OPENCLAW_CONSULT='false';process.env.PHONE_MESSAGES_DIR=dir;console.info=(label,s)=>{if(label==='[PHONE_DIAGNOSTIC]')events.push(JSON.parse(s));};
 t.after(()=>{console.info=oldInfo;for(const [env,key]of [['GEMINI_API_KEY','key'],['LIVE_OPENCLAW_CONSULT','consult'],['PHONE_MESSAGES_DIR','messages']])old[key]===undefined?delete process.env[env]:process.env[env]=old[key];fs.rmSync(dir,{recursive:true,force:true});});
 const dialog=new EventEmitter();dialog.connected=true;dialog.destroy=async()=>{dialog.connected=false;dialog.emit('destroy');};const waits=new Map();let media,accept=true,callbacks,ready,ack;
 const greeted=new Promise(r=>ready=r),saved=new Promise(r=>ack=r),server={expectSession:key=>new Promise((resolve,reject)=>waits.set(key,{resolve,reject})),cancelExpectation:key=>waits.get(key)?.reject(Error('cancelled'))};
 const endpoint={uuid:'synthetic',api:async cmd=>cmd==='help'?'bidirectional stream stop_play':'+OK',forkAudioStart:async opts=>{media=new EventEmitter();media.sendPcm=()=>accept;media.close=()=>{};waits.get(opts.wsUrl.split('/').pop()).resolve(media);},forkAudioStop:async()=>{},destroy:async()=>{}};
 const running=runLiveCall(endpoint,dialog,'synthetic-observation',{audioForkServer:server},{connect:async opts=>{callbacks=opts.callbacks;return {sendRealtimeInput:()=>{},sendClientContent:()=>ready(),sendToolResponse:()=>ack(),close:()=>{}};}});
 await greeted;callbacks.onmessage({toolCall:{functionCalls:[{id:'one-save',name:'record_message',args:{name:'Synthetic',callback:'000',reason:'Offline synthetic test',consent:true}}]}});await saved;
 accept=false;assert.equal(media.sendPcm(Buffer.alloc(960),'model'),false);accept=true;media.sendPcm(Buffer.alloc(960),'padding');media.sendPcm(Buffer.alloc(960),'cue');assert.equal(events.some(e=>e.event==='post-save-playout-submitted'),false);media.sendPcm(Buffer.alloc(960),'model');assert.equal(events.filter(e=>e.event==='post-save-playout-submitted').length,1);
 dialog.connected=false;dialog.emit('destroy');await running;const summary=events.find(e=>e.event==='live-call-summary');assert.equal(summary.outputPcmBytes,2880);assert.equal(summary.outputSpeechPcmBytes,960);assert.equal(summary.postSavePlayoutBytes,960);assert.equal(summary.postSavePaddingBytes,960);assert.equal(summary.postSaveCueBytes,960);assert.equal(summary.postSaveModelBytes,0);
});
