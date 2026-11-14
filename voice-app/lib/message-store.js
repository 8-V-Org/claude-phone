'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {failure,audit,messageError}=require('./phone-diagnostics');
function validateMessage(data){
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['name','callback','reason','consent'].includes(k)))throw messageError('INVALID_MESSAGE','Expected name, callback, reason and consent fields only');
 if(data.consent!==true)throw messageError('CONSENT_REQUIRED','Read back details and obtain explicit permission, then set consent=true');
 const out={};for(const [key,max]of [['name',120],['callback',40],['reason',1000]]){const v=data[key];if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f\x7f]/.test(v))throw messageError('INVALID_'+key.toUpperCase(),'A nonempty '+key+' within the length limit is required; do not include control characters');out[key]=v.trim();}
 if(!/^[+0-9(). -]{3,40}$/.test(out.callback))throw messageError('INVALID_CALLBACK','Callback must be 3–40 digits/phone punctuation, not spoken words');return out;
}
class MessageStore{
 constructor(dir,{maxMessages=1000}={}){this.dir=dir;this.maxMessages=maxMessages;this.tail=Promise.resolve();fs.mkdirSync(dir,{recursive:true,mode:0o700});const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Private message directory required');fs.chmodSync(dir,0o700);const probe=path.join(dir,'.probe-'+crypto.randomUUID());const fd=fs.openSync(probe,'wx',0o600);fs.closeSync(fd);fs.unlinkSync(probe);}
 async read(reference){
  if(typeof reference!=='string'||! /^[a-f0-9]{32}$/.test(reference))throw messageError('INVALID_REFERENCE','Expected a message reference');
  const handle=await fsp.open(path.join(this.dir,reference+'.json'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size>8192)throw messageError('INVALID_RECORD','Invalid private message file');const data=JSON.parse(await handle.readFile('utf8'));if(data.reference!==reference||typeof data.createdAt!=='string'||!Number.isFinite(Date.parse(data.createdAt)))throw messageError('INVALID_RECORD','Record metadata mismatch');const fields=validateMessage({name:data.name,callback:data.callback,reason:data.reason,consent:true});return {reference,createdAt:data.createdAt,...fields,fileMode:(stat.mode&0o777).toString(8),bytes:stat.size};}finally{await handle.close();}
 }
 save(callId,data){const record=validateMessage(data);if(typeof callId!=='string'||!callId||callId.length>256)return Promise.reject(Error('Invalid call reference'));const task=this.tail.then(async()=>{const reference=crypto.createHash('sha256').update(callId).digest('hex').slice(0,32),file=path.join(this.dir,reference+'.json');
   try{const prior=JSON.parse(await fsp.readFile(file,'utf8'));if(prior.reference!==reference)throw Error('Invalid prior message');validateMessage({name:prior.name,callback:prior.callback,reason:prior.reason,consent:true});return {recorded:true,alreadyRecorded:true,reference};}catch(error){if(error.code!=='ENOENT')throw messageError('PRIOR_RECORD_INVALID','Existing message requires staff review');}
   const files=await fsp.readdir(this.dir);if(files.filter(x=>x.endsWith('.json')).length>=this.maxMessages)throw messageError('INBOX_FULL','Message inbox is full; staff intervention required');
   const handle=await fsp.open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify({reference,createdAt:new Date().toISOString(),...record})+'\n');await handle.sync();}catch(error){await handle.close();await fsp.unlink(file).catch(()=>{});throw error;}await handle.close();return {recorded:true,reference};
  });this.tail=task.catch(()=>{});return task;}
}
let shared;
function getMessageStore(){if(shared)return shared;try{const dir=path.resolve(process.env.PHONE_MESSAGES_DIR||'/app/messages'),audio=path.resolve(process.env.AUDIO_DIR||'/app/audio');if(dir===audio||dir.startsWith(audio+path.sep))throw Error('Public audio storage forbidden');shared=new MessageStore(dir);audit('message-store-ready',{maxMessages:shared.maxMessages});return shared;}catch(error){audit('message-store-unavailable',failure(error));return null;}}
module.exports={validateMessage,MessageStore,getMessageStore};
