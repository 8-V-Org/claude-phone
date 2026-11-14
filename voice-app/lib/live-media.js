'use strict';
const {EventEmitter}=require('node:events'),WebSocket=require('ws');
const {audit}=require('./phone-diagnostics');
class LiveMediaSession extends EventEmitter {
 constructor(ws,key){super();this.ws=ws;this.key=key;
  ws.on('message',(data,binary)=>{if(!binary)return;if(data.length%2||data.length>32000){this.emit('fault',Error('Invalid media frame'));ws.close(1009);return;}this.emit('pcm',Buffer.from(data));});
  ws.on('close',(code,reason)=>this.emit('closed',{code,reason:reason?.toString().slice(0,200)}));ws.on('error',error=>this.emit('fault',error));
 }
 sendPcm(data){if(this.ws.readyState!==WebSocket.OPEN)throw Error('Media socket closed');if(this.ws.bufferedAmount>4800)return false;this.ws.send(data,{binary:true});return true;}
 close(){this.ws.close();}
}
class LiveAudioForkServer extends EventEmitter {
 constructor({port=3001,host='127.0.0.1'}={}){super();this.port=port;this.host=host;this.pending=new Map();this.sessions=new Set();}
 start(){this.wss=new WebSocket.Server({port:this.port,host:this.host,maxPayload:32768});
  this.wss.on('connection',(ws,req)=>{const key=String(req.url||'').slice(1);const p=this.pending.get(key);if(!p){audit('live-media-rejected',{pendingExpectations:this.pending.size});ws.close(1008,'Unexpected stream');return;}this.pending.delete(key);clearTimeout(p.timer);const s=new LiveMediaSession(ws,key);this.sessions.add(s);s.on('closed',()=>this.sessions.delete(s));p.resolve(s);});
  this.wss.on('listening',()=>this.emit('listening'));this.wss.on('error',()=>this.emit('error',Error('Live media listener failed')));
 }
 expectSession(key,{timeoutMs=10000}={}){if(this.pending.size||this.pending.has(key))return Promise.reject(Error('Media expectation busy'));return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(key);reject(Error('Media connect timeout'));},timeoutMs);this.pending.set(key,{resolve,reject,timer});});}
 cancelExpectation(key){const p=this.pending.get(key);if(!p)return;clearTimeout(p.timer);this.pending.delete(key);p.reject(Error('Media expectation cancelled'));}
 stop(){for(const key of this.pending.keys())this.cancelExpectation(key);for(const s of this.sessions)s.ws.terminate();this.sessions.clear();if(this.wss)this.wss.close();}
}
class LivePlayout {
 constructor({resetMedia,onFault=()=>{},onOverflow,onSpill,onInterrupt,thinkingCue=null,maxBytes=480000,maxSpillBytes=0,tailPaddingMs=0,intervalMs=20,now=Date.now,stallTimeoutMs=2000}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<2||maxBytes%2||!Number.isSafeInteger(maxSpillBytes)||maxSpillBytes<0||maxSpillBytes%2||!Number.isFinite(tailPaddingMs)||tailPaddingMs<0||tailPaddingMs>1000)throw Error('Invalid playback bounds');
  Object.assign(this,{resetMedia,onFault,onOverflow,onSpill,onInterrupt,thinkingCue,maxBytes,maxSpillBytes,now,stallTimeoutMs});this.tailPaddingBytes=Math.ceil(tailPaddingMs/20)*960;this.tailRemaining=0;this.needsTail=false;this.paddingSubmitted=0;this.spill=null;this.spillEpisodes=0;this.spilledBytes=0;this.maxMemoryPending=0;this.backpressureTicks=0;this.blockedSince=null;this.maxEnqueueMs=0;this.maxReadMs=0;this.lastTickAt=null;this.maxTickGapMs=0;this.cueSubmitted=0;this.queue=[];this.bytes=0;this.media=null;this.paused=false;this.closed=false;this.epoch=0;this.chain=Promise.resolve();this.overflows=0;this.discarded=0;this.maxPending=0;this.submitted=0;this.timer=setInterval(()=>this.tick(),intervalMs);
 }
 snapshot(){return {playoutPending:this.bytes,playoutMaxPending:this.maxPending,playoutMemoryMaxPending:this.maxMemoryPending,playoutOverflows:this.overflows,playoutDiscarded:this.discarded,playoutSubmitted:this.submitted,playoutEpoch:this.epoch,consultCueSubmitted:this.cueSubmitted,playoutSpillEpisodes:this.spillEpisodes,playoutSpilledBytes:this.spilledBytes,playoutPaddingSubmitted:this.paddingSubmitted,playoutBackpressureTicks:this.backpressureTicks,playoutMaxEnqueueMs:this.maxEnqueueMs,playoutMaxReadMs:this.maxReadMs,playoutMaxTickGapMs:this.maxTickGapMs};}
 clearQueue(){this.spill?.close();this.spill=null;this.queue=[];this.bytes=0;this.tailRemaining=0;this.needsTail=false;this.blockedSince=null;}
 dropOldest(n){if(this.spill){this.spill.consume(n);this.bytes-=n;return;}let left=n;while(left>0&&this.queue.length){const head=this.queue[0];if(head.length<=left){this.queue.shift();this.bytes-=head.length;left-=head.length;}else{this.queue[0]=head.subarray(left);this.bytes-=left;left=0;}}}
 enqueue(data){
  if(this.closed||!data.length)return;
  if(data.length%2)throw Error('Live playback frame not 16-bit PCM');
  const started=this.now();this.tailRemaining=0;this.needsTail=true;
  const cap=Math.max(this.maxBytes,this.maxSpillBytes);let chunk=data,dropped=0;
  if(chunk.length>cap){dropped+=chunk.length-cap;chunk=chunk.subarray(0,cap);}
  const overflow=this.bytes+chunk.length-cap;
  if(overflow>0){this.dropOldest(overflow);dropped+=overflow;}
  if(dropped){this.overflows++;this.discarded+=dropped;try{this.onOverflow?.({dropped,pending:this.bytes,admitting:chunk.length,maxBytes:cap,memoryBytes:this.maxBytes,epoch:this.epoch,policy:'capacity-drop'});}catch{}}
  if(!this.spill&&this.bytes+chunk.length>this.maxBytes){
   const {PcmSpill}=require('./pcm-spill');const spill=new PcmSpill(cap);
   try{for(const head of this.queue)spill.append(head);}catch(error){spill.close();throw error;}
   this.spill=spill;this.queue=[];this.spillEpisodes++;this.spilledBytes+=this.bytes;
   try{this.onSpill?.({pending:this.bytes,admitting:chunk.length,memoryBytes:this.maxBytes,capacityBytes:cap,epoch:this.epoch});}catch{}
  }
  if(this.spill){this.spill.append(chunk);this.spilledBytes+=chunk.length;}else{this.queue.push(Buffer.from(chunk));this.maxMemoryPending=Math.max(this.maxMemoryPending,this.bytes+chunk.length);}
  this.bytes+=chunk.length;this.maxPending=Math.max(this.maxPending,this.bytes);this.maxEnqueueMs=Math.max(this.maxEnqueueMs,this.now()-started);
 }
 completeTurn(){if(!this.closed&&this.needsTail){this.tailRemaining=this.tailPaddingBytes;this.needsTail=false;}}
 peek(size){if(this.spill)return this.spill.peek(size);const out=Buffer.alloc(size);let offset=0;for(const head of this.queue){const n=Math.min(head.length,size-offset);head.copy(out,offset,0,n);offset+=n;if(offset===size)break;}return out;}
 tick(){
  const now=this.now();if(this.lastTickAt!==null)this.maxTickGapMs=Math.max(this.maxTickGapMs,now-this.lastTickAt);this.lastTickAt=now;
  if(this.closed||this.paused||!this.media)return;
  try{
   const readStarted=this.now(),kind=this.bytes?'model':this.tailRemaining?'padding':'cue';
   const out=kind==='model'?this.peek(Math.min(960,this.bytes)):kind==='padding'?Buffer.alloc(Math.min(960,this.tailRemaining)):this.thinkingCue?.frame();
   this.maxReadMs=Math.max(this.maxReadMs,this.now()-readStarted);if(!out)return;
   // A temporary socket backlog must NOT consume/drop the frame or end the call.
   if(this.media.sendPcm(out,kind)===false){this.backpressureTicks++;this.blockedSince??=this.now();if(this.now()-this.blockedSince>=this.stallTimeoutMs)throw Error('Media playback stalled');return;}
   this.blockedSince=null;
   if(kind==='cue'){this.cueSubmitted+=out.length;return;}
   if(kind==='padding'){this.tailRemaining-=out.length;this.paddingSubmitted+=out.length;return;}
   this.dropOldest(out.length);this.submitted+=out.length;
   if(!this.bytes&&this.spill){this.spill.close();this.spill=null;}
  }catch(error){this.onFault(error);}
 }
 interrupt(origin='local'){try{this.onInterrupt?.({origin,epoch:this.epoch,queuedAudioMs:Math.round(this.bytes/48),paddingMs:Math.round(this.tailRemaining/48)});}catch{}this.thinkingCue?.stop('barge-in');if(this.bytes)this.discarded+=this.bytes;this.clearQueue();this.paused=true;const epoch=++this.epoch;
  this.chain=this.chain.then(()=>this.closed?null:this.resetMedia()).then(media=>{if(this.closed){media?.close();return;}this.media=media;if(epoch===this.epoch)this.paused=false;}).catch(error=>this.onFault(error));return this.chain;
 }
 close(){this.thinkingCue?.stop('call-ended');this.closed=true;clearInterval(this.timer);this.clearQueue();this.media=null;}
}
function toLittleEndian(data,format='LE'){if(format==='LE')return data;if(format==='BE')return Buffer.from(data).swap16();throw Error('Invalid PCM byte order');}
module.exports={LiveAudioForkServer,LiveMediaSession,LivePlayout,toLittleEndian};
