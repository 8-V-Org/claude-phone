'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Endpoint=require('drachtio-fsmrf/lib/endpoint');
const {BUG_NAME,checkCapability,startFork,stopPlayback,stopFork,retireFork}=require('../lib/live-fork');
function fixture(replies){
 const commands=[];
 const ep=Object.create(Endpoint.prototype);
 Object.defineProperty(ep,'uuid',{value:'test-channel'});
 const queue=Array.isArray(replies)?replies.slice():null;
 ep.api=(cmd,args,cb)=>{
  commands.push({cmd,args});
  const text=queue&&queue.length?queue.shift():(cmd==='help'?'uuid_audio_fork stop_play bidirectionalAudio_enabled bidirectionalAudio_stream_enabled':'+OK');
  const res={getBody:()=>text};
  if(cb){cb(null,res);return ep;}
  return Promise.resolve(res);
 };
 return {ep,commands};
}
test('capability uses help registry, never invokes uuid_audio_fork with null/empty command',async()=>{
 const f=fixture();
 assert.equal(await checkCapability(f.ep),true);
 assert.deepEqual(f.commands,[{cmd:'help',args:'uuid_audio_fork'}]);
});
test('start uses compatible default bug audio_fork, metadata and explicit streaming rates',async()=>{
 const f=fixture();
 await startFork(f.ep,'ws://127.0.0.1:3001/test');
 const c=f.commands[0];
 assert.equal(c.cmd,'uuid_audio_fork');
 assert.equal(c.args,"^^|test-channel|start|ws://127.0.0.1:3001/test|mono|16000|audio_fork|'{}'|true|true|24000");
 assert.equal(BUG_NAME,'audio_fork');
 assert.notEqual(BUG_NAME,'phone_live');
});
test('stop_play uses default bug (name omitted); stop uses matching audio_fork name',async()=>{
 const f=fixture();
 await stopPlayback(f.ep);
 await stopFork(f.ep);
 assert.deepEqual(f.commands[0],{cmd:'uuid_audio_fork',args:['test-channel','stop_play']});
 assert.deepEqual(f.commands[1],{cmd:'uuid_audio_fork',args:['test-channel','stop','audio_fork']});
});
test('stop_play error is preserved instead of a generic reset error',async()=>{
 await assert.rejects(stopPlayback({uuid:'x',api:async()=>'-ERR no bug'}),/stop_play failed: -ERR no bug/);
});
test('retireFork is non-fatal: stop_play failure is returned, stop still runs',async()=>{
 const f=fixture(['-ERR no bug','+OK']);
 const errors=await retireFork(f.ep);
 assert.equal(errors.length,1);
 assert.match(errors[0].message,/stop_play failed: -ERR no bug/);
 assert.deepEqual(f.commands[0],{cmd:'uuid_audio_fork',args:['test-channel','stop_play']});
 assert.deepEqual(f.commands[1],{cmd:'uuid_audio_fork',args:['test-channel','stop','audio_fork']});
});
test('start/stop/reset names are consistent (all audio_fork, never phone_live)',async()=>{
 const f=fixture();
 await startFork(f.ep,'ws://127.0.0.1:3001/x');
 await stopPlayback(f.ep);
 await stopFork(f.ep);
 const dumped=JSON.stringify(f.commands);
 assert.match(dumped,/audio_fork/);
 assert.doesNotMatch(dumped,/phone_live/);
});
