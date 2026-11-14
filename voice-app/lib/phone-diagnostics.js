'use strict';
const codes=new Set(['EACCES','EPERM','EROFS','ENOSPC','EDQUOT','EMFILE','ENFILE','ENOENT','EEXIST','CONSENT_REQUIRED','INVALID_NAME','INVALID_CALLBACK','INVALID_REASON','INVALID_MESSAGE','INBOX_FULL','PRIOR_RECORD_INVALID','STORE_UNAVAILABLE','CANCELLED']);
function failure(error){return {code:codes.has(error?.code)?error.code:'STORAGE_ERROR',type:error?.name==='TypeError'?'TypeError':'Error'};}
function audit(event,fields={}){console.info('[PHONE_DIAGNOSTIC]',JSON.stringify({time:new Date().toISOString(),event,...fields}));}
function safeError(error){
 let message=String(error?.message||error?.reason||error||'Unknown failure');
 for(const [name,value]of Object.entries(process.env))if(/KEY|TOKEN|SECRET|PASSWORD|AUTH_ID/.test(name)&&value&&value.length>=4)message=message.split(value).join('[redacted]');
 message=message.replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').replace(/([?&](?:key|api_key|token|secret|password)=)[^&\s"']+/gi,'$1[redacted]').replace(/wss?:\/\/[^\s"']+/gi,'ws://[redacted]').replace(/[\r\n\x00-\x1f]+/g,' ').slice(0,1000);
 return {message,...(Number.isInteger(error?.code)?{code:error.code}:{}),...(Number.isInteger(error?.status)?{status:error.status}:{})};
}
function messageError(code,message){return Object.assign(new Error(message),{code});}
module.exports={failure,audit,messageError,safeError};
