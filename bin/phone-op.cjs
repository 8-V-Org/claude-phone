#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),{createHmac,randomUUID}=require('node:crypto');
async function main(){
 const [action,toOrId,id,...options]=process.argv.slice(2);let conversation=false,message;
 for(let i=0;i<options.length;i++){if(options[i]==='--conversation')conversation=true;else if(options[i]==='--message-file'&&options[i+1])message=fs.readFileSync(options[++i],'utf8').trim();else throw Error('Unknown option');}
 if(!['status','probe-save','dial','job','validate'].includes(action))throw Error('Usage: node bin/phone-op.cjs status | probe-save [requestId] | validate EXT_OR_NUMBER | dial EXT_OR_NUMBER REQUEST_ID [--conversation] [--message-file PATH] | job JOB_ID');
 if(message!==undefined&&(!conversation||action!=='dial'||!message||message.length>2000||/[\x00-\x1f\x7f]/.test(message)))throw Error('Message requires conversational dial and 1-2000 printable characters');
 const base='http://127.0.0.1:3333';const raw=fs.readFileSync(process.env.PHONE_BRIDGE_TOKEN_FILE||'/opt/data/secrets/phone/bridge-token','utf8').trim();const token=createHmac('sha256',raw).update('phone-operator-v1').digest('hex');
 const request=async(route,data)=>{const r=await fetch(base+route,{method:data?'POST':'GET',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(8000)});const result=await r.json();if(!r.ok)throw Error('HTTP '+r.status+': '+(result.error||'operation rejected'));return result;};
 if(action==='status'){console.log(JSON.stringify(await request('/phone/status')));return;}
 if(action==='job'){console.log(JSON.stringify(await request('/phone/jobs/'+encodeURIComponent(toOrId))));return;}
 if(action==='validate'){if(!toOrId)throw Error('Usage: node bin/phone-op.cjs validate EXT_OR_NUMBER');console.log(JSON.stringify(await request('/phone/jobs',{action:'validate',to:toOrId})));return;}
 const data={action,requestId:(action==='dial'?id:toOrId)||randomUUID(),...(action==='dial'?{to:toOrId,...(conversation?{conversation:true}:{}),...(message!==undefined?{message}:{})}:{})};const queued=await request('/phone/jobs',data);console.log(JSON.stringify({...queued,requestId:data.requestId}));
 for(let i=0;i<240;i++){await new Promise(r=>setTimeout(r,1000));const state=await request('/phone/jobs/'+queued.id);if(['completed','failed','indeterminate'].includes(state.state)){console.log(JSON.stringify(state));if(state.state!=='completed')process.exitCode=1;return;}}
 throw Error('Result not yet known. Inspect job ID; do not automatically repeat a dial.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
