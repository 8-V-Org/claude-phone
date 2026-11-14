'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {LivePlayout,toLittleEndian}=require('./live-media');
const {ConsultCue}=require('./consult-cue');
const {PhoneControls}=require('./phone-controls');
const {loadFeatureConfig}=require('./phone-feature-policy');
const {LiveToolRouter,buildLiveConfig,routeLiveMessage}=require('./live-tools');
const {loadReceptionist,greetingPrompt,closingPrompt}=require('./receptionist');
const {getMessageStore}=require('./message-store');
const {scheduleEnding}=require('./call-ending');
const {audit,safeError}=require('./phone-diagnostics');
const {checkCapability,stopPlayback,startFork,stopFork}=require('./live-fork');
const {hangupDetails,safeSipCallId}=require('./call-end-diagnostics');
const {safeUsage,safeTurnEnd}=require('./live-turn-diagnostics');
function transportDetail(error){const message=String(error?.message||error?.reason||'');const classification=/quota|resource.exhaust/i.test(message)?'quota':/permission|unauth|forbidden/i.test(message)?'permission':/not.found|not supported|unsupported/i.test(message)?'unsupported':/invalid/i.test(message)?'invalid-request':/timeout|timed.out/i.test(message)?'timeout':'transport';return {classification,...(Number.isInteger(error?.code)?{transportCode:error.code}:{}),...(Number.isInteger(error?.status)?{transportStatus:error.status}:{})};}
function deadline(promise,ms=5000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Media control timeout')),ms);})]).finally(()=>clearTimeout(timer));}
async function runLiveCall(endpoint,dialog,callId,{audioForkServer,wsPort=3001,deadlineAt=null,callContext={tier:'message-only'},outbound=false,outboundMessage,srf=null,mediaServer=null},{connect}={}){
 let phoneControls=null,mediaSuspended=false;
 let google,media=null,pendingKey=null,closed=false,closing=false,settle,cancelEnding=()=>{};const done=new Promise(r=>settle=r);let failure=null,endReason='unknown',hardTimer=null,lastSaveAckAt=null,firstPostSaveModelAudio=false,firstPostSavePlayout=false;const stats={inputPcmBytes:0,modelPcmBytes:0,outputPcmBytes:0,mediaResets:0,postSaveModelBytes:0,postSavePlayoutBytes:0,outputSpeechPcmBytes:0,outputPaddingPcmBytes:0,outputCuePcmBytes:0,postSavePaddingBytes:0,postSaveCueBytes:0};
 const logFailure=(event,error)=>audit(event,{callId,stage,...transportDetail(error),...safeError(error)});
 const finish=(error,reason='failure')=>{if(closed)return;closed=true;failure=error||null;endReason=reason;settle();};
 const onDialogEnd=(req,reason)=>{audit('live-sip-hangup',{callId,stage,...hangupDetails(req,reason),queuedAudioMs:Math.round(playout.bytes/48),postSaveMs:lastSaveAckAt===null?null:Date.now()-lastSaveAckAt});finish(null,'sip-hangup');};dialog.on('destroy',onDialogEnd);
 const key=process.env.GEMINI_API_KEY;
 const endian=process.env.LIVE_INPUT_ENDIAN||'LE';
 let windowStart=Date.now(),inputBytes=0;
 const onPcm=pcm=>{if(closed||closing||mediaSuspended||!google)return;stats.inputPcmBytes+=pcm.length;if(stats.inputPcmBytes===pcm.length)audit('live-first-input-pcm',{callId,bytes:pcm.length});try{const now=Date.now();if(now-windowStart>=1000){windowStart=now;inputBytes=0;}inputBytes+=pcm.length;if(inputBytes>64000)throw Error('Media rate limit');const input=toLittleEndian(pcm,endian);if(thinkingCue.observeInput(input))void playout.interrupt();google.sendRealtimeInput({audio:{data:input.toString('base64'),mimeType:'audio/pcm;rate=16000'}});}catch(error){logFailure('live-input-failed',error);finish(error);}};
 const onMediaEnd=error=>{const err=error instanceof Error?error:Error('FreeSWITCH media WebSocket closed unexpectedly'+(Number.isInteger(error?.code)?' (code '+error.code+')':'')+(error?.reason?': '+error.reason:''));logFailure('live-media-failed',err);finish(err);};
 async function resetMedia(){
  if(closed)throw Error('Call ended');
  const old=media;media=null;
  if(old){old.removeListener('pcm',onPcm);old.removeListener('closed',onMediaEnd);old.removeListener('fault',onMediaEnd);
   // Stop playback first, then retire the media bug to remove BOTH prebuffer and
   // playout buffer. stop_play alone does not prove both buffers were cleared.
   await deadline(stopPlayback(endpoint));
   await deadline(stopFork(endpoint));old.close();stats.mediaResets++;
   audit('live-media-reset',{callId,resets:stats.mediaResets});
  }
  if(closed)throw Error('Call ended');
  const streamKey=callId+'-'+crypto.randomBytes(16).toString('hex');pendingKey=streamKey;
  const ready=audioForkServer.expectSession(streamKey);ready.catch(()=>{});
  try{
   await deadline(startFork(endpoint,'ws://127.0.0.1:'+wsPort+'/'+streamKey));
   audit('live-fork-start-ack',{callId});
   const current=await Promise.race([ready,done.then(()=>{throw failure||Error('SIP/Live session ended before media connected');})]);pendingKey=null;if(closed){current.close();throw Error('Call ended');}
   media=current;const sendPcm=current.sendPcm.bind(current);current.sendPcm=(data,kind='model')=>{if(sendPcm(data)===false)return false;stats.outputPcmBytes+=data.length;const speech=kind==='model';stats[speech?'outputSpeechPcmBytes':kind==='padding'?'outputPaddingPcmBytes':'outputCuePcmBytes']+=data.length;if(lastSaveAckAt!==null){stats[speech?'postSavePlayoutBytes':kind==='padding'?'postSavePaddingBytes':'postSaveCueBytes']+=data.length;if(speech&&!firstPostSavePlayout){firstPostSavePlayout=true;audit('post-save-playout-submitted',{callId,sinceAckMs:Date.now()-lastSaveAckAt,queuedAudioMs:Math.round(playout.bytes/48),meaning:'model speech bytes submitted to media socket; content/audibility not verified'});}}if(speech&&stats.outputSpeechPcmBytes===data.length)audit('live-first-output-pcm',{callId,bytes:data.length});return true;};audit('live-media-connected',{callId});current.on('pcm',onPcm);current.on('closed',onMediaEnd);current.on('fault',onMediaEnd);return current;
  }catch(error){logFailure('live-fork-start-failed',error);audioForkServer.cancelExpectation(streamKey);pendingKey=null;throw error;}
 }
 const thinkingCue=new ConsultCue({onEvent:(event,data)=>audit(event,{callId,...data})});
 const playout=new LivePlayout({thinkingCue,resetMedia,maxSpillBytes:2880000,tailPaddingMs:320,onSpill:info=>audit('live-playback-spill',{callId,...info}),onInterrupt:info=>audit('live-output-interrupted',{callId,...info}),onFault:error=>{logFailure('live-playout-failed',error);finish(error);},onOverflow:info=>audit('live-playback-overflow',{callId,...info})});
 let tools,setupTimer,stage='capability';
 try{
  if(!key||!['LE','BE'].includes(endian))throw Error('Live key or PCM format missing');
  audit('live-call-start',{callId,outbound,tier:callContext.tier,sipCallId:safeSipCallId(dialog),remainingLimitMs:Number.isFinite(deadlineAt)?Math.max(0,deadlineAt-Date.now()):null});
  if(Number.isFinite(deadlineAt)&&deadlineAt>0)hardTimer=setTimeout(()=>{audit('live-local-end-request',{callId,reason:'duration-limit',queuedAudioMs:Math.round(playout.bytes/48)});finish(null,'duration-limit');},Math.max(0,deadlineAt-Date.now()));
  await deadline(checkCapability(endpoint));
  stage='configuration';
  const reception=loadReceptionist();
  const messageStore=getMessageStore();
  const tier=callContext.tier==='approved'?'approved':'message-only';
  const consult=tier==='approved'&&process.env.LIVE_OPENCLAW_CONSULT==='true';
  const token=consult?crypto.createHmac('sha256',fs.readFileSync(process.env.PHONE_BRIDGE_TOKEN_FILE,'utf8').trim()).update('phone-approved-consult-v1').digest('hex'):'';
  if(tier==='approved'&&srf&&mediaServer)phoneControls=new PhoneControls({tier,dialog,endpoint,srf,mediaServer,phoneConfig:loadFeatureConfig(),callId,suspendMedia:async()=>{mediaSuspended=true;thinkingCue.stop('phone-operation');await playout.interrupt();playout.paused=true;},resumeMedia:async()=>{if(!closed&&!closing){mediaSuspended=false;await playout.interrupt();}},onTransferred:()=>finish(null,'transfer-completed')});
  tools=new LiveToolRouter({phoneControls,token,callId,maxCalls:consult?16:0,approvedFaq:null,messageStore,tier,onMessageAckSubmitted:()=>{lastSaveAckAt=Date.now();audit('message-ack-submitted',{callId,queuedAudioMs:Math.round(playout.bytes/48),meaning:'provider submission only; not proof of spoken acknowledgement'});},onConsultStart:()=>thinkingCue.start(),onConsultEnd:()=>thinkingCue.stop(),onFault:finish,send:response=>{if(!closed&&google)google.sendToolResponse(response);}});
  if(!connect){const {GoogleGenAI}=require('@google/genai');const ai=new GoogleGenAI({apiKey:key,httpOptions:{apiVersion:'v1beta'}});connect=options=>ai.live.connect(options);}
  stage='google-connect';
  const connecting=Promise.resolve(connect({model:process.env.GEMINI_LIVE_MODEL||'gemini-3.8-live',config:buildLiveConfig({voice:process.env.GEMINI_LIVE_VOICE||'Kore',consult,receptionist:reception,canTakeMessages:!!messageStore,tier,phoneControlsAvailable:!!phoneControls,outboundMessage:outbound?outboundMessage:undefined}),callbacks:{
   onmessage:message=>{if(closed)return;try{if(message.setupComplete)audit('live-google-setup-complete',{callId});for(const part of message.serverContent?.modelTurn?.parts||[])if(part.inlineData?.data){const bytes=Buffer.byteLength(part.inlineData.data,'base64');stats.modelPcmBytes+=bytes;if(lastSaveAckAt!==null){stats.postSaveModelBytes+=bytes;if(!firstPostSaveModelAudio){firstPostSaveModelAudio=true;audit('post-save-model-audio',{callId,sinceAckMs:Date.now()-lastSaveAckAt,meaning:'audio generated after result; spoken content/audibility not verified'});}}}if(message.usageMetadata)audit('live-provider-usage',{callId,...safeUsage(message.usageMetadata)});if(message.serverContent?.turnCompleteReason||message.serverContent?.waitingForInput)audit('live-provider-turn-end',{callId,...safeTurnEnd(message.serverContent)});if(message.serverContent?.generationComplete||message.serverContent?.turnComplete)audit('live-model-turn-state',{callId,generationComplete:!!message.serverContent.generationComplete,turnComplete:!!message.serverContent.turnComplete,queuedAudioMs:Math.round(playout.bytes/48)});routeLiveMessage(message,{playout,tools,finish});}catch(error){logFailure('live-response-failed',error);finish(error);}},
   onerror:error=>{logFailure('live-transport-error',error);finish(Error('Gemini Live transport failed'));},onclose:event=>{if(!closed){logFailure('live-transport-closed',event);finish(Error('Gemini Live closed before SIP hangup'),'provider-close');}}
  }})).then(session=>{if(closed)session.close();return session;});
  google=await Promise.race([connecting,new Promise((_,reject)=>{setupTimer=setTimeout(()=>reject(Error('Live setup timed out')),10000);})]);clearTimeout(setupTimer);
  if(closed)throw Error('Live closed during setup');
  stage='media-connect';
  const initialMedia=resetMedia();
  // Queue early VAD interruptions behind initial media setup, never start two
  // native forks/expectations concurrently for the same channel.
  playout.chain=initialMedia.then(()=>{});playout.chain.catch(()=>{});
  playout.media=await initialMedia;
  if(closed)throw Error('Call ended during media setup');
  stage='greeting';
  google.sendClientContent({turns:[{role:'user',parts:[{text:greetingPrompt(reception,{canTakeMessages:!!messageStore,tier,outbound,outboundMessage})}]}],turnComplete:true});
  cancelEnding=scheduleEnding({deadlineAt,announce:async()=>{
    if(closed)return;closing=true;tools.close();
    await playout.interrupt();if(!closed)google.sendClientContent({turns:[{role:'user',parts:[{text:closingPrompt}]}],turnComplete:true});
  }});
  stage='conversation';
  await done;
  if(failure)throw failure;
 }catch(error){failure ||= error;if(endReason==='unknown')endReason='setup-or-runtime-failure';logFailure('live-call-failed',error);throw Error(error?.message?.startsWith('Installed audio-fork')?error.message:'Live call failed; check model access, media capability and private logs.');}
 finally{
  closed=true;cancelEnding();clearTimeout(setupTimer);clearTimeout(hardTimer);const pendingAtEnd=playout.bytes;playout.close();tools?.close();
  if(phoneControls)try{await deadline(phoneControls.close(),8000);}catch(error){logFailure('phone-controls-cleanup-failed',error);}
  if(pendingKey)audioForkServer.cancelExpectation(pendingKey);
  try{google?.close();}catch{}
  if(media){media.removeListener('pcm',onPcm);media.removeListener('closed',onMediaEnd);media.removeListener('fault',onMediaEnd);try{media.close();}catch{}}
  if(media||pendingKey)try{await deadline(stopFork(endpoint),2000);}catch(error){logFailure('live-fork-cleanup-failed',error);}
  audit('live-call-summary',{callId,stage,endReason,failure:!!failure,...stats,...playout.snapshot(),playoutPendingAtEnd:pendingAtEnd,lastSaveAckMsAgo:lastSaveAckAt===null?null:Date.now()-lastSaveAckAt});
  dialog.removeListener('destroy',onDialogEnd);
  if(dialog.connected!==false)try{audit('live-local-end-request',{callId,reason:'cleanup',afterEndReason:endReason});await deadline(dialog.destroy(),2000);}catch{}
  try{await deadline(endpoint.destroy(),2000);}catch{}
 }
 return {endReason};
}
module.exports={runLiveCall,deadline};
