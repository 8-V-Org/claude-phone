#!/usr/bin/env node
'use strict';
const http=require('node:http'),fs=require('node:fs/promises');
const {normalizeDestination,acceptedDestination}=require('./lib/destination');
function resolvedDestination(value){
 const dest=normalizeDestination(value,{allowPstn:true})||normalizeDestination(value,{allowPstn:false});
 if(dest&&dest.error)throw Error(dest.message);
 if(!acceptedDestination(dest))throw Error('Invalid destination');
 return dest;
}
async function requestPhoneAPI(command,value,{socketPath=process.env.PHONE_API_SOCKET||'/opt/data/phone/phone-messages/phone-api.sock',tokenFile=process.env.PHONE_API_TOKEN_FILE||'/opt/data/phone/secrets/bridge-token'}={}){
 let method='GET',path,body;
 if(command==='health')path='/health';
 else if(command==='probe'){method='POST';path='/api/messages/probe';body={};}
 else if(command==='dial'||command==='validate'){
  const dest=resolvedDestination(value);
  method='POST';path='/api/outbound-call';body=command==='validate'?{to:dest.to,dryRun:true}:{to:dest.to};
 }else if(command==='status'||command==='hangup'){
  if(typeof value!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(value))throw Error('Invalid call identifier');
  path='/api/outbound-call/'+value;
  if(command==='hangup'){path+='/hangup';method='POST';body={};}
 }else throw Error('Usage: node phone-api.cjs health|probe|validate <extension-or-number>|dial <extension-or-number>|status <callId>|hangup <callId>');
 const token=(await fs.readFile(tokenFile,'utf8')).trim();
 return new Promise((resolve,reject)=>{
  const req=http.request({socketPath,path,method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},timeout:10000},res=>{
   let text='';res.on('data',b=>{text+=b;if(text.length>65536)res.destroy(Error('Control response too large'));});res.on('error',reject);
   res.on('end',()=>{let data;try{data=JSON.parse(text);}catch{return reject(Error('Invalid control response'));}
    if(res.statusCode<200||res.statusCode>=300)return reject(Error('Phone API HTTP '+res.statusCode+': '+(data.error||'request failed')));resolve(data);
   });
  });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Phone API timed out')));req.end(body?JSON.stringify(body):undefined);
 });
}
if(require.main===module)requestPhoneAPI(process.argv[2],process.argv[3]).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={requestPhoneAPI};
