'use strict';
const fs=require('node:fs'), fsp=require('node:fs/promises'), path=require('node:path'), os=require('node:os'), crypto=require('node:crypto');
const {spawn}=require('node:child_process');
let audioDir=process.env.AUDIO_DIR||'/tmp/phone-audio';
function pcmToWav(pcm,sampleRate=16000){
 if(!Buffer.isBuffer(pcm)||pcm.length%2||pcm.length>4*1024*1024)throw Error('Invalid or oversized PCM');
 const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(sampleRate,24);h.writeUInt32LE(sampleRate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);
}
function cli(args,stdin=''){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.env.GEMINI_API_BIN||'/usr/local/bin/gemini-api',args,{stdio:['pipe','pipe','pipe'],shell:false});
  let count=0,done=false; const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('Speech provider timed out'));},30000);
  const finish=err=>{if(done)return;done=true;clearTimeout(timer);err?reject(err):resolve();};
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{count+=b.length;if(count>65536){child.kill('SIGKILL');finish(Error('Speech output limit exceeded'));}});
  child.on('error',()=>finish(Error('Speech CLI unavailable')));child.on('close',n=>finish(n===0?null:Error('Speech CLI failed (code '+n+')')));
  child.stdin.on('error',()=>{});child.stdin.end(stdin);
 });
}
async function requestOpenAI(endpoint,body){
 const key=process.env.OPENAI_API_KEY;if(!key)throw Error('OpenAI speech key missing');
 const r=await fetch('https://api.openai.com/v1/audio/'+endpoint,{method:'POST',headers:{Authorization:'Bearer '+key,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});
 if(!r.ok)throw Error('OpenAI speech HTTP '+r.status);return r;
}
async function transcribe(buffer,{format='pcm',sampleRate=16000,language='en'}={}){
 const audio=format==='pcm'?pcmToWav(buffer,sampleRate):buffer;
 const provider=process.env.STT_PROVIDER||'gemini';
 if(provider==='openai'){
  const form=new FormData();form.append('file',new Blob([audio],{type:'audio/wav'}),'utterance.wav');form.append('model',process.env.OPENAI_STT_MODEL||'gpt-4o-mini-transcribe');form.append('language',language);form.append('response_format','json');
  const result=await(await requestOpenAI('transcriptions',form)).json();if(typeof result.text!=='string')throw Error('No transcription');return result.text.trim();
 }
 if(provider!=='gemini')throw Error('Unsupported STT provider');
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'phone-stt-'));
 try{const input=path.join(dir,'in.wav'),output=path.join(dir,'out.txt');await fsp.writeFile(input,audio,{mode:0o600});
  await cli(['transcribe','-i',input,'--format','text','--no-speakers','--no-timestamps','--model',process.env.GEMINI_STT_MODEL||'gemini-3.5-transcribe','--out',output]);
  const text=await fsp.readFile(output,'utf8');if(text.length>8000)throw Error('Transcript too long');return text.trim();
 }finally{await fsp.rm(dir,{recursive:true,force:true});}
}
function setAudioDir(dir){audioDir=dir;fs.mkdirSync(dir,{recursive:true,mode:0o700});}
async function generateSpeech(text){
 if(typeof text!=='string'||!text.trim()||text.length>4000)throw Error('Invalid TTS input');
 setAudioDir(audioDir);const cacheKey=crypto.createHash('sha256').update(JSON.stringify([process.env.TTS_PROVIDER,process.env.GEMINI_TTS_MODEL,process.env.GEMINI_TTS_VOICE,process.env.OPENAI_TTS_MODEL,process.env.OPENAI_TTS_VOICE,text])).digest('hex');
 const filename='tts-'+cacheKey+'.wav',out=path.join(audioDir,filename);
 try { if((await fsp.stat(out)).size>44)return 'http://127.0.0.1:3000/audio-files/'+filename; } catch {}
 try{
  const provider=process.env.TTS_PROVIDER||'gemini';
  if(provider==='gemini')await cli(['tts','--stdin','--voice',process.env.GEMINI_TTS_VOICE||'Kore','--model',process.env.GEMINI_TTS_MODEL||'gemini-3.8-flash-tts','--out',out],text);
  else if(provider==='openai'){
   const r=await requestOpenAI('speech',{model:process.env.OPENAI_TTS_MODEL||'gpt-4o-mini-tts',voice:process.env.OPENAI_TTS_VOICE||'coral',input:text,response_format:'wav'});await fsp.writeFile(out,Buffer.from(await r.arrayBuffer()),{mode:0o600});
  }else throw Error('Unsupported TTS provider');
  const stat=await fsp.stat(out);if(stat.size>10*1024*1024)throw Error('TTS audio too large');
  const header=Buffer.alloc(12);const fd=await fsp.open(out,'r');try{await fd.read(header,0,12,0);}finally{await fd.close();}
  if(header.toString('ascii',0,4)!=='RIFF'||header.toString('ascii',8,12)!=='WAVE')throw Error('Provider returned non-WAV audio');
  return 'http://127.0.0.1:3000/audio-files/'+filename;
 }catch(e){await fsp.rm(out,{force:true});throw e;}
}
module.exports={transcribe,pcmToWav,isAvailable:()=>!!process.env.GEMINI_API_KEY||!!process.env.OPENAI_API_KEY,setAudioDir,generateSpeech,cli};
