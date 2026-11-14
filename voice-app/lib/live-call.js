'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {LivePlayout,toLittleEndian}=require('./live-media');
const log=require('./logger');
const {LiveToolRouter,buildLiveConfig,routeLiveMessage}=require('./live-tools');
const {checkCapability,startFork,stopFork,retireFork}=require('./live-fork');
function sanitizedError(error){return String(error?.message||error).replace(/(Bearer\s+)\S+/ig,'$1<redacted>').replace(/(token|secret|password|key)=\S+/ig,'$1=<redacted>').replace(/ws:\/\/\S+/ig,'ws://<redacted>');}
function deadline(promise,ms=5000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Media control timeout')),ms);})]).finally(()=>clearTimeout(timer));}
async function runLiveCall(endpoint,dialog,callId,{audioForkServer,wsPort=3001,callerTier='message',bridgeToken,messageStore,phoneTools=null,phoneContext={},srf,mediaServer,env=process.env},{connect,createPbxBinding=require('./pbx-binding').createPbxBinding}={}){
 let google,media=null,pendingKey=null,closed=false,mediaSuspended=false,settle;const done=new Promise(r=>settle=r);let failure=null;
 const finish=error=>{if(closed)return;closed=true;failure=error||null;settle();};
 const onDialogEnd=()=>finish();dialog.on('destroy',onDialogEnd);
 const key=process.env.GEMINI_API_KEY;
 const endian=process.env.LIVE_INPUT_ENDIAN||'LE';
 let windowStart=Date.now(),inputBytes=0;
 const onPcm=pcm=>{if(closed||mediaSuspended||!google)return;try{const now=Date.now();if(now-windowStart>=1000){windowStart=now;inputBytes=0;}inputBytes+=pcm.length;if(inputBytes>64000)throw Error('Media rate limit');google.sendRealtimeInput({audio:{data:toLittleEndian(pcm,endian).toString('base64'),mimeType:'audio/pcm;rate=16000'}});}catch{finish(Error('Live input failed'));}};
 const onMediaEnd=()=>finish(Error('Media stream closed'));
 async function resetMedia(){
  if(closed)throw Error('Call ended');
  const old=media;media=null;
  if(old){old.removeListener('pcm',onPcm);old.removeListener('closed',onMediaEnd);old.removeListener('fault',onMediaEnd);
   // Stop playback first, then retire the media bug to remove BOTH prebuffer and
   // playout buffer. Use the bug name the installed module honors (audio_fork).
   // A failed stop is non-fatal: log a sanitized error, close stale audio, continue.
   const retireErrors=await retireFork(endpoint,p=>deadline(p));
   for(const err of retireErrors){try{log.warn('live-fork-retire-failed',{callId,error:sanitizedError(err)});}catch{}}
   old.close();
  }
  if(closed)throw Error('Call ended');
  const streamKey=callId+'-'+crypto.randomBytes(16).toString('hex');pendingKey=streamKey;
  const ready=audioForkServer.expectSession(streamKey);ready.catch(()=>{});
  try{
   await deadline(startFork(endpoint,'ws://127.0.0.1:'+wsPort+'/'+streamKey));
   const current=await ready;pendingKey=null;if(closed){current.close();throw Error('Call ended');}
   media=current;current.on('pcm',onPcm);current.on('closed',onMediaEnd);current.on('fault',onMediaEnd);return current;
  }catch(error){audioForkServer.cancelExpectation(streamKey);pendingKey=null;throw error;}
 }
 const playout=new LivePlayout({resetMedia,onFault:finish,onOverflow:info=>log.warn('live-playback-overflow',{callId,...info})});
 let tools,setupTimer;
 try{
  if(!key||!['LE','BE'].includes(endian))throw Error('Live key or PCM format missing');
  await deadline(checkCapability(endpoint));
  const consult=callerTier==='approved'&&process.env.LIVE_OPENCLAW_CONSULT!=='false';
  if(messageStore===undefined)messageStore=require('./message-store').getMessageStore();
  const token=consult?(bridgeToken??fs.readFileSync(process.env.PHONE_BRIDGE_TOKEN_FILE,'utf8').trim()):'';
  if(!phoneTools&&srf&&callerTier==='approved')phoneTools=createPbxBinding({srf,endpoint,dialog,mediaServer,env,callerTier,
  onSessionStart:async()=>{mediaSuspended=true;playout.cue.stop();playout.paused=true;playout.queue=[];playout.bytes=0;const old=media;media=null;playout.media=null;if(old){old.removeListener('pcm',onPcm);old.removeListener('closed',onMediaEnd);old.removeListener('fault',onMediaEnd);await retireFork(endpoint,p=>deadline(p));old.close();}},
  onSessionEnd:async()=>{if(closed)return;playout.media=await resetMedia();mediaSuspended=false;playout.paused=false;}
 });
 tools=new LiveToolRouter({cue:playout.cue,phoneTools,phoneContext,token,callId,callerTier,consult,messageStore,maxCalls:consult?64:0,send:response=>{if(!closed&&google)google.sendToolResponse(response);}});
  if(!connect){const {GoogleGenAI}=require('@google/genai');const ai=new GoogleGenAI({apiKey:key,httpOptions:{apiVersion:'v1beta'}});connect=options=>ai.live.connect(options);}
  const connecting=Promise.resolve(connect({model:process.env.GEMINI_LIVE_MODEL||'gemini-3.8-live',config:buildLiveConfig({voice:process.env.GEMINI_LIVE_VOICE||'Kore',consult,callerTier,phoneTools,canTakeMessages:!!messageStore}),callbacks:{
   onmessage:message=>{if(closed)return;if(mediaSuspended&&message.serverContent)return;try{routeLiveMessage(message,{playout,tools,finish});}catch{finish(Error('Invalid Live response or audio limit'));}},
   onerror:()=>finish(Error('Gemini Live transport failed')),onclose:()=>finish()
  }})).then(session=>{if(closed)session.close();return session;});
  google=await Promise.race([connecting,new Promise((_,reject)=>{setupTimer=setTimeout(()=>reject(Error('Live setup timed out')),10000);})]);clearTimeout(setupTimer);
  if(closed)throw Error('Live closed during setup');
  playout.media=await resetMedia();
  if(closed)throw Error('Call ended during media setup');
  google.sendClientContent({turns:[{role:'user',parts:[{text:callerTier==='approved'?'Briefly greet the caller as an AI assistant and ask how you can help.':'Briefly introduce yourself as an AI assistant and offer to take a private message for the owner. Ask for the caller name first.'}]}],turnComplete:true});
  await done;
  if(failure)throw failure;
 }catch(error){throw Error(error?.message?.startsWith('Installed audio-fork')?error.message:'Live call failed; check model access, media capability and private logs.');}
 finally{
  closed=true;clearTimeout(setupTimer);playout.close();tools?.close();
  try{await deadline(Promise.resolve(phoneTools?.close?.()),3000);}catch{}
  if(pendingKey)audioForkServer.cancelExpectation(pendingKey);
  try{google?.close();}catch{}
  if(media){media.removeListener('pcm',onPcm);media.removeListener('closed',onMediaEnd);media.removeListener('fault',onMediaEnd);try{media.close();}catch{}}
  try{await deadline(stopFork(endpoint),2000);}catch(error){try{log.warn('live-fork-cleanup-failed',{callId,error:sanitizedError(error)});}catch{}}
  try{log.info('live-call-summary',{callId,failure:!!failure,...playout.snapshot()});}catch{}
  dialog.removeListener('destroy',onDialogEnd);
  try{await deadline(dialog.destroy(),2000);}catch{}
  try{await deadline(endpoint.destroy(),2000);}catch{}
 }
}
module.exports={runLiveCall,deadline};
