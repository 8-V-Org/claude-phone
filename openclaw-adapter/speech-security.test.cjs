const {test}=require('node:test'),assert=require('node:assert/strict'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const speech=require('../voice-app/lib/speech-providers'),{createCallGate}=require('../voice-app/lib/call-gate');
function req({source='192.0.2.10',caller='100',extension='9000'}={}){return {source_address:source,get:k=>k==='From'?'sip:'+caller+'@pbx':'sip:'+extension+'@pbx'};}
test('PCM WAV preserves 16kHz mono signed samples',()=>{const pcm=Buffer.from([0,0,255,127,0,128]);const w=speech.pcmToWav(pcm,16000);assert.equal(w.toString('ascii',0,4),'RIFF');assert.equal(w.readUInt32LE(24),16000);assert.equal(w.readUInt16LE(22),1);assert.deepEqual(w.subarray(44),pcm);assert.throws(()=>speech.pcmToWav(Buffer.alloc(3)));});
test('Gemini file/stdin interfaces and repeated TTS cue cache',async t=>{
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'phone-speech-test-')),fake=path.join(dir,'gemini-api'),count=path.join(dir,'count');
 await fsp.copyFile(path.join(__dirname,'fake-gemini.cjs'),fake);await fsp.chmod(fake,0o700);
 const keys=['GEMINI_API_BIN','FAKE_CLI_COUNT','STT_PROVIDER','TTS_PROVIDER'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{GEMINI_API_BIN:fake,FAKE_CLI_COUNT:count,STT_PROVIDER:'gemini',TTS_PROVIDER:'gemini'});
 t.after(async()=>{for(const k of keys)before[k]===undefined?delete process.env[k]:process.env[k]=before[k];await fsp.rm(dir,{recursive:true,force:true});});
 speech.setAudioDir(path.join(dir,'audio'));assert.equal(await speech.transcribe(Buffer.alloc(320),{sampleRate:16000}),'Turn on the light.');
 const first=await speech.generateSpeech('Hello there.'),second=await speech.generateSpeech('Hello there.');assert.equal(first,second);assert.ok(first.endsWith('.wav'));assert.equal((await fsp.readFile(count,'utf8')).length,2);
});
test('OpenAI selection uses explicit requests and expected models',async t=>{
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'phone-openai-test-')),before={STT_PROVIDER:process.env.STT_PROVIDER,TTS_PROVIDER:process.env.TTS_PROVIDER,OPENAI_API_KEY:process.env.OPENAI_API_KEY},original=global.fetch;
 Object.assign(process.env,{STT_PROVIDER:'openai',TTS_PROVIDER:'openai',OPENAI_API_KEY:'test-only-not-real'});const calls=[];
 global.fetch=async(url,options)=>{calls.push({url,options});const w=speech.pcmToWav(Buffer.alloc(8));return {ok:true,json:async()=>({text:'Hello caller.'}),arrayBuffer:async()=>Uint8Array.from(w).buffer};};
 t.after(async()=>{global.fetch=original;for(const k in before)before[k]===undefined?delete process.env[k]:process.env[k]=before[k];await fsp.rm(dir,{recursive:true,force:true});});
 speech.setAudioDir(dir);assert.equal(await speech.transcribe(Buffer.alloc(10)),'Hello caller.');await speech.generateSpeech('OpenAI test.');assert.equal(calls.length,2);assert.equal(calls[0].options.body.get('model'),'gpt-4o-mini-transcribe');assert.equal(JSON.parse(calls[1].options.body).model,'gpt-4o-mini-tts');
});
test('call gate fails closed without configuration',async()=>{let code;await createCallGate()(req(),{send:c=>code=c},()=>assert.fail('must deny'));assert.equal(code,403);});
test('call gate rejects wrong source or extension',async()=>{for(const input of [{source:'192.0.2.11'},{extension:'9001'}]){let code;await createCallGate({sources:['192.0.2.10'],callers:['100'],extension:'9000'})(req(input),{send:c=>code=c},()=>assert.fail('must deny'));assert.equal(code,403);}});
test('one-call admission and release',async()=>{const gate=createCallGate({sources:['192.0.2.10'],callers:['100'],extension:'9000'});let release,started;const ready=new Promise(r=>started=r);const active=gate(req(),{send:()=>assert.fail('must accept')},async()=>{started();await new Promise(r=>release=r);});await ready;let code;await gate(req(),{send:c=>code=c},()=>assert.fail('must be busy'));assert.equal(code,486);release();await active;let accepted=false;await gate(req(),{send:()=>assert.fail('must accept')},async()=>{accepted=true;});assert.ok(accepted);});
test('admission is released after handler errors',async()=>{const gate=createCallGate({sources:['192.0.2.10'],callers:['100'],extension:'9000'});await assert.rejects(gate(req(),{send:()=>{}},async()=>{throw Error('test');}));let ran=false;await gate(req(),{send:()=>{}},async()=>ran=true);assert.ok(ran);});
