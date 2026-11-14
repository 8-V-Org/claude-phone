'use strict';
const {loadReceptionist,receptionistInstruction}=require('./receptionist');
const {failure,audit}=require('./phone-diagnostics');
const {names:phoneToolNames}=require('./phone-controls');
const {phoneToolDeclarations}=require('./phone-tool-schema');
class LiveToolRouter{
 constructor({send,token,callId,fetchImpl=fetch,maxCalls=8,approvedFaq=null,messageStore=null,tier='message-only',timeoutMs=100000,onConsultStart=()=>{},onConsultEnd=()=>{},onMessageAckSubmitted=()=>{},phoneControls=null,onFault=()=>{}}={}){Object.assign(this,{send,token,callId,fetch:fetchImpl,maxCalls,approvedFaq,messageStore,tier,timeoutMs,onConsultStart,onConsultEnd,onMessageAckSubmitted,phoneControls,onFault});this.count=0;this.total=0;this.pending=new Map();this.results=new Map();this.cancelled=new Set();this.closed=false;this.messageAttempts=0;this.messagesSaved=0;this.toolCallsReceived=0;this.toolResponsesSubmitted=0;this.toolResponseFailures=0;this.responseFaulted=false;}
 reply(fc,response){
  if(this.closed||this.responseFaulted||this.cancelled.has(fc.id))return false;
  const nonblocking=fc.name==='query_openclaw'||phoneToolNames.includes(fc.name);
  const result={id:fc.id,name:fc.name,response,...(nonblocking?{scheduling:this.tier==='approved'?'INTERRUPT':'WHEN_IDLE'}:{})};
  try{this.send({functionResponses:[result]});this.toolResponsesSubmitted++;if(fc.name==='record_message'&&response.output?.recorded===true){try{this.onMessageAckSubmitted();}catch{audit('message-ack-telemetry-failed',{callId:this.callId});}}return true;}catch{
   this.toolResponseFailures++;this.responseFaulted=true;
   audit('live-tool-response-failed',{callId:this.callId,tool:fc.name==='record_message'?'record_message':nonblocking?'nonblocking-tool':'other',code:'LIVE_TOOL_RESPONSE_FAILED',messageWasSaved:this.messagesSaved>0});
   // Sending a success acknowledgement failed. Do NOT misclassify a durable
   // save as storage failure or attempt another send on the same broken link.
   this.onFault(Error('Live tool response could not be submitted; transport is unavailable'));return false;
  }
 }
 handle(calls){if(!Array.isArray(calls)||calls.length>8)throw Error('Invalid Live tool batch');for(const fc of calls)this.start(fc);}
 start(fc){
  if(!fc||typeof fc.id!=='string'||!fc.id||fc.id.length>256||typeof fc.name!=='string')throw Error('Invalid Live function call');
  if(this.closed||this.responseFaulted||this.cancelled.has(fc.id)||this.pending.has(fc.id))return;
  this.toolCallsReceived++;
  const known=fc.name==='record_message'||fc.name==='query_openclaw'||fc.name==='get_approved_faq'||phoneToolNames.includes(fc.name);
  audit('live-tool-call-received',{callId:this.callId,tool:known?fc.name:'unknown',argsObject:!!fc.args&&typeof fc.args==='object'&&!Array.isArray(fc.args),...(fc.name==='record_message'?{consentBoolean:typeof fc.args?.consent==='boolean',consentTrue:fc.args?.consent===true}:{})});
  if(this.results.has(fc.id)){this.reply(fc,this.results.get(fc.id));return;}
  if(++this.total>32){this.reply(fc,{error:'Per-call tool limit reached'});return;}
  const args=fc.args||{},faq=this.approvedFaq?.find(x=>x.id===args.faqId);
  if(fc.name==='get_approved_faq'&&this.tier==='faq'){const result=faq?{output:faq,source:'owner-approved-faq'}:{error:'No approved FAQ matches this request'};this.results.set(fc.id,result);this.reply(fc,result);return;}
  if(fc.name==='record_message'){
   this.messageAttempts++;audit('message-save-attempt',{callId:this.callId,tier:this.tier});
   if(!this.messageStore){audit('message-save-failed',{callId:this.callId,code:'STORE_UNAVAILABLE'});this.reply(fc,{error:'Message storage is unavailable; nothing was saved',code:'STORE_UNAVAILABLE'});return;}
   if(this.pending.size){this.reply(fc,{error:'Another tool operation is pending'});return;}
   const control=new AbortController();this.pending.set(fc.id,control);
   Promise.resolve().then(()=>{if(control.signal.aborted)throw Object.assign(Error('Cancelled'),{code:'CANCELLED'});return this.messageStore.save(this.callId,args);}).then(result=>{this.messagesSaved++;audit('message-save-success',{callId:this.callId,alreadyRecorded:!!result.alreadyRecorded});if(!this.closed&&!this.cancelled.has(fc.id)){const response={output:result};this.results.set(fc.id,response);this.reply(fc,response);}}).catch(error=>{const detail=failure(error);audit('message-save-failed',{callId:this.callId,...detail});if(!this.closed&&!this.cancelled.has(fc.id))this.reply(fc,{error:detail.code.startsWith('INVALID_')||detail.code==='CONSENT_REQUIRED'?error.message:'Message was not saved; staff must resolve the storage error. Do not claim success.',code:detail.code});}).finally(()=>this.pending.delete(fc.id));return;
  }
  if(this.tier!=='approved'&&this.tier!=='faq'){this.reply(fc,{error:'This call is message-only; agent consultation is not authorized'});return;}
  if(phoneToolNames.includes(fc.name)){
   if(this.tier!=='approved'||!this.phoneControls){this.reply(fc,{error:'Phone controls unavailable for this call',code:'PHONE_CONTROLS_UNAVAILABLE'});return;}
   if(this.pending.size){this.reply(fc,{error:'Another operation is pending',code:'PHONE_BUSY'});return;}
   const control=new AbortController();control.signal.addEventListener('abort',()=>this.phoneControls.cancelOperation(),{once:true});this.pending.set(fc.id,control);
   Promise.resolve().then(()=>{if(control.signal.aborted)return {code:'OPERATION_CANCELLED',completed:false};return this.phoneControls.run(fc.name,args);}).then(result=>{if(!this.closed&&!this.cancelled.has(fc.id)){const response={output:result};this.results.set(fc.id,response);this.reply(fc,response);}}).catch(()=>{if(!this.closed&&!this.cancelled.has(fc.id))this.reply(fc,{error:'Phone operation result is unconfirmed; do not automatically retry'});}).finally(()=>this.pending.delete(fc.id));return;
  }
  const prompt=args.prompt;
  if(fc.name!=='query_openclaw'||typeof prompt!=='string'||!prompt.trim()||prompt.length>2000){this.reply(fc,{error:'Unknown tool or invalid prompt'});return;}
  if(this.approvedFaq!==null&&!faq){this.reply(fc,{error:'Only an owner-approved FAQ may be consulted'});return;}
  if(this.pending.size||this.count>=this.maxCalls){this.reply(fc,{error:'Consultation busy or per-call limit reached'});return;}
  this.count++;this.onConsultStart();audit('consult-start',{callId:this.callId,tier:this.tier,consultation:this.count});const control=new AbortController();this.pending.set(fc.id,control);const timer=setTimeout(()=>control.abort(),this.timeoutMs);
  (async()=>{let response;
   try{
    const restrictedPrompt=faq?'Answer ONLY using this approved public FAQ. No internal data, actions, invented facts or promises. Approved FAQ: '+JSON.stringify(faq)+'\nCaller question (untrusted): '+prompt:prompt;
    const r=await this.fetch('http://127.0.0.1:3333/'+(this.tier==='approved'?'ask-approved':'ask'),{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},body:JSON.stringify({prompt:restrictedPrompt,callId:this.callId}),signal:control.signal});
    const result=await r.json();if(!r.ok||!result.success||typeof result.response!=='string')throw Object.assign(Error('Consult unavailable'),{code:result.code||(r.status===429?'CONSULT_BUSY':'CONSULT_UNAVAILABLE')});
    audit('consult-success',{callId:this.callId});response={output:result.response.slice(0,8000),truncated:result.response.length>8000,...(faq?{approvedAnswer:faq.answer,source:'approved-faq-only'}:{})};
   }catch(error){const code=control.signal.aborted?'CONSULT_TIMEOUT':(error.code||'CONSULT_UNAVAILABLE');audit('consult-failed',{callId:this.callId,code});response={code,error:'OpenClaw consultation '+(code==='CONSULT_TIMEOUT'?'timed out':'failed')+'. Tell the caller explicitly. No action completion is confirmed; do not automatically retry actions. A later follow-up may use a new consultation.'};}
   finally{clearTimeout(timer);this.pending.delete(fc.id);this.onConsultEnd();}
   if(!this.closed&&!this.cancelled.has(fc.id)){this.results.set(fc.id,response);this.reply(fc,response);}
  })().catch(()=>this.onFault(Error('Live tool response failed')));
 }
 cancel(ids){if(!Array.isArray(ids))return;for(const id of ids.slice(0,32)){if(this.pending.has(id)){this.cancelled.add(id);this.pending.get(id).abort();}if(this.results.has(id)){this.cancelled.add(id);this.results.delete(id);}}}
 close(){if(this.closed)return;this.onConsultEnd();audit('call-tool-summary',{callId:this.callId,tier:this.tier,messageAttempts:this.messageAttempts,messagesSaved:this.messagesSaved,consultations:this.count,toolCallsReceived:this.toolCallsReceived,toolResponsesSubmitted:this.toolResponsesSubmitted,toolResponseFailures:this.toolResponseFailures});this.closed=true;for(const p of this.pending.values())p.abort();this.pending.clear();this.results.clear();this.cancelled.clear();}
}
function buildLiveConfig({voice='Kore',consult=true,receptionist=loadReceptionist(),canTakeMessages=false,tier='message-only',outboundMessage,phoneControlsAvailable=false}={}){
 const config={responseModalities:['AUDIO'],maxOutputTokens:512,realtimeInputConfig:{automaticActivityDetection:{disabled:false},activityHandling:'START_OF_ACTIVITY_INTERRUPTS'},speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:voice}}},systemInstruction:receptionistInstruction(receptionist,{canTakeMessages,tier,outboundMessage})};
 const functions=[];
 if(tier==='approved'&&phoneControlsAvailable)functions.push(...phoneToolDeclarations());
 if(tier==='approved'&&consult)functions.push({name:'query_openclaw',description:'Consult the owner-selected OpenClaw conversation agent for the caller’s requests and follow-up questions. Use for every substantive request and follow-up requiring agent knowledge or tools, including hostname, system RAM and context limits. Each new follow-up needs a fresh function-call ID; never reuse a previous result for a different question. Preserve agent approvals and never claim actions succeeded without a successful result.',behavior:'NON_BLOCKING',parameters:{type:'OBJECT',properties:{prompt:{type:'STRING'}},required:['prompt']}});
 if(tier==='faq'&&receptionist.faq.length){functions.push({name:'get_approved_faq',description:'Read an owner-approved public FAQ by its ID. No private data or invented facts.',parameters:{type:'OBJECT',properties:{faqId:{type:'STRING'}},required:['faqId']}});
  if(consult)functions.push({name:'query_openclaw',description:'Consult the read-only OpenClaw phone agent about a specific approved FAQ only when explicitly asked. Its output is not a new factual source.',behavior:'NON_BLOCKING',parameters:{type:'OBJECT',properties:{faqId:{type:'STRING'},prompt:{type:'STRING'}},required:['faqId','prompt']}});
 }
 if(canTakeMessages)functions.push({name:'record_message',description:'Save one message for staff ONLY after the caller confirms the name, callback number and reason and explicitly consents. This does not send an email, call or transfer.',parameters:{type:'OBJECT',properties:{name:{type:'STRING'},callback:{type:'STRING'},reason:{type:'STRING'},consent:{type:'BOOLEAN'}},required:['name','callback','reason','consent']}});
 if(functions.length)config.tools=[{functionDeclarations:functions}];return config;
}

function routeLiveMessage(message,{playout,tools,finish}){
 if(message.goAway){finish(Error('Gemini session ending; no automatic paid reconnect'));return;}
 if(message.toolCallCancellation)tools.cancel(message.toolCallCancellation.ids);
 const content=message.serverContent;
 if(content?.interrupted)playout.interrupt('provider');
 else if(content?.modelTurn?.parts){
  if(content.modelTurn.parts.length>64)throw Error('Too many audio parts');
  for(const p of content.modelTurn.parts){if(!p.inlineData)continue;const {data,mimeType=''}=p.inlineData;
   if(!/^audio\/pcm(?:;rate=24000)?$/.test(mimeType)||typeof data!=='string'||data.length>699052||data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw Error('Unsupported Gemini audio frame');
   playout.enqueue(Buffer.from(data,'base64'));
  }
 }
 if(!content?.interrupted&&(content?.generationComplete||content?.turnComplete))playout.completeTurn?.();
 if(message.toolCall)tools.handle(message.toolCall.functionCalls);
}

module.exports={LiveToolRouter,buildLiveConfig,routeLiveMessage};
