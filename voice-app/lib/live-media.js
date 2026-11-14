'use strict';
const {EventEmitter}=require('node:events'),WebSocket=require('ws');
const {ThinkingCue}=require('./thinking-cue');
class LiveMediaSession extends EventEmitter {
 constructor(ws,key){super();this.ws=ws;this.key=key;
  ws.on('message',(data,binary)=>{if(!binary)return;if(data.length%2||data.length>32000){this.emit('fault',Error('Invalid media frame'));ws.close(1009);return;}this.emit('pcm',Buffer.from(data));});
  ws.on('close',()=>this.emit('closed'));ws.on('error',()=>this.emit('fault',Error('Media connection failed')));
 }
 sendPcm(data){if(this.ws.readyState!==WebSocket.OPEN)throw Error('Media socket closed');if(this.ws.bufferedAmount>4800)throw Error('Media backpressure');this.ws.send(data,{binary:true});}
 close(){this.ws.close();}
}
class LiveAudioForkServer extends EventEmitter {
 constructor({port=3001,host='127.0.0.1'}={}){super();this.port=port;this.host=host;this.pending=new Map();this.sessions=new Set();}
 start(){this.wss=new WebSocket.Server({port:this.port,host:this.host,maxPayload:32768});
  this.wss.on('connection',(ws,req)=>{const key=String(req.url||'').slice(1);const p=this.pending.get(key);if(!p){ws.close(1008,'Unexpected stream');return;}this.pending.delete(key);clearTimeout(p.timer);const s=new LiveMediaSession(ws,key);this.sessions.add(s);s.on('closed',()=>this.sessions.delete(s));p.resolve(s);});
  this.wss.on('listening',()=>this.emit('listening'));this.wss.on('error',()=>this.emit('error',Error('Live media listener failed')));
 }
 expectSession(key,{timeoutMs=10000}={}){if(this.pending.size||this.pending.has(key))return Promise.reject(Error('Media expectation busy'));return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(key);reject(Error('Media connect timeout'));},timeoutMs);this.pending.set(key,{resolve,reject,timer});});}
 cancelExpectation(key){const p=this.pending.get(key);if(!p)return;clearTimeout(p.timer);this.pending.delete(key);p.reject(Error('Media expectation cancelled'));}
 stop(){for(const key of this.pending.keys())this.cancelExpectation(key);for(const s of this.sessions)s.ws.terminate();this.sessions.clear();if(this.wss)this.wss.close();}
}
class LivePlayout {
 constructor({resetMedia,onFault,onOverflow,maxBytes=480000,intervalMs=20}={}){this.cue=new ThinkingCue();this.resetMedia=resetMedia;this.onFault=onFault;this.onOverflow=onOverflow;this.maxBytes=maxBytes;this.queue=[];this.bytes=0;this.media=null;this.paused=false;this.closed=false;this.epoch=0;this.chain=Promise.resolve();this.overflows=0;this.discarded=0;this.maxPending=0;this.submitted=0;this.timer=setInterval(()=>this.tick(),intervalMs);}
 snapshot(){return {playoutPending:this.bytes,playoutMaxPending:this.maxPending,playoutOverflows:this.overflows,playoutDiscarded:this.discarded,playoutSubmitted:this.submitted,playoutEpoch:this.epoch};}
 dropOldest(n){let left=n;while(left>0&&this.queue.length){const head=this.queue[0];if(head.length<=left){this.queue.shift();this.bytes-=head.length;left-=head.length;}else{this.queue[0]=head.subarray(left);this.bytes-=left;left=0;}}}
 enqueue(data){
  if(this.closed||!data.length)return;
  if(data.length%2)throw Error('Live playback frame not 16-bit PCM');
  let chunk=data,dropped=0;
  // A single Gemini part may be up to ~524289 bytes (routeLiveMessage cap),
  // which already exceeds the 10s / 480000-byte bound. Admit the head and
  // drop the tail so the caller still hears the start of the utterance.
  if(chunk.length>this.maxBytes){dropped+=chunk.length-this.maxBytes;chunk=chunk.subarray(0,this.maxBytes);}
  const overflow=this.bytes+chunk.length-this.maxBytes;
  if(overflow>0){this.dropOldest(overflow);dropped+=overflow;}
  if(dropped){this.overflows++;this.discarded+=dropped;try{this.onOverflow?.({dropped,pending:this.bytes,admitting:chunk.length,maxBytes:this.maxBytes,epoch:this.epoch});}catch{}}
  this.queue.push(Buffer.from(chunk));this.bytes+=chunk.length;if(this.bytes>this.maxPending)this.maxPending=this.bytes;
 }
 tick(){if(this.closed||this.paused||!this.media)return;try{if(!this.bytes){const frame=this.cue.nextFrame();if(frame)this.media.sendPcm(frame);return;}const out=Buffer.alloc(Math.min(960,this.bytes));let offset=0;while(offset<out.length){const head=this.queue[0],count=Math.min(head.length,out.length-offset);head.copy(out,offset,0,count);offset+=count;this.bytes-=count;if(count===head.length)this.queue.shift();else this.queue[0]=head.subarray(count);}this.media.sendPcm(out);this.submitted+=out.length;}catch{this.onFault(Error('Live playback failed'));}}
 interrupt(){this.cue.stop();if(this.bytes)this.discarded+=this.bytes;this.queue=[];this.bytes=0;this.paused=true;const epoch=++this.epoch;
  this.chain=this.chain.then(()=>this.closed?null:this.resetMedia()).then(media=>{if(this.closed){media?.close();return;}this.media=media;if(epoch===this.epoch)this.paused=false;}).catch(()=>this.onFault(Error('Playback reset failed')));return this.chain;
 }
 close(){this.closed=true;clearInterval(this.timer);this.queue=[];this.bytes=0;this.media=null;}
}
function toLittleEndian(data,format='LE'){if(format==='LE')return data;if(format==='BE')return Buffer.from(data).swap16();throw Error('Invalid PCM byte order');}
module.exports={LiveAudioForkServer,LiveMediaSession,LivePlayout,toLittleEndian};
