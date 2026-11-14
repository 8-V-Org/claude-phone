'use strict';
const net=require('node:net');const {performance}=require('node:perf_hooks');
function uriUser(value){
 if(typeof value!=='string'||value.length>2048||/[\r\n\x00]/.test(value))return null;
 let text=value.trim();if(text.includes('<')){const start=text.indexOf('<'),end=text.indexOf('>',start);if(end<0)return null;text=text.slice(start+1,end).trim();}
 const match=/^sips?:([^@;?\s<>]+)@[^;?\s<>]+/i.exec(text);if(!match)return null;
 try{const user=decodeURIComponent(match[1]);return user.length<=128&&!/[\x00-\x20\x7f]/.test(user)?user:null;}catch{return null;}
}
function createCallGate({sources=[],callers=[],extension,callerPolicy='allowlist',maxConcurrent=1,rateLimit=6,rateWindowMs=60000,maxBuckets=1024,capacity=null,now=()=>performance.now(),audit=()=>{}}={}){
 if(!['allowlist','trusted-source-any','tiered'].includes(callerPolicy)||!Number.isSafeInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>4||!Number.isSafeInteger(rateLimit)||rateLimit<1||rateLimit>60||!Number.isSafeInteger(rateWindowMs)||rateWindowMs<1000||rateWindowMs>300000||!Number.isSafeInteger(maxBuckets)||maxBuckets<1||maxBuckets>4096)throw Error('Invalid call gate policy');
 capacity ||= require('./call-capacity').createCapacity(maxConcurrent);
 const trusted=new Set(sources.map(x=>String(x).replace(/^::ffff:/,''))),allowed=new Set(callers);const buckets=new Map();
 const reply=(res,status,reason,retry)=>{audit({event:'invite-denied',status,reason});res.send(status,retry?{headers:{'Retry-After':String(retry)}}:undefined);};
 return async(req,res,run)=>{
  const source=String(req.source_address||'').replace(/^::ffff:/,'');
  if(!net.isIP(source)||!trusted.has(source))return reply(res,403,'source');
  const target=uriUser(req.uri),to=uriUser(req.get('To'));
  if(typeof extension!=='string'||target!==extension||to!==extension)return reply(res,403,'target');
  const caller=uriUser(req.get('From'));
  if(callerPolicy==='allowlist'&&(caller===null||!allowed.has(caller)))return reply(res,403,'caller');
  const bucketKey=caller&&/^\+?\d{1,32}$/.test(caller)?caller:'anonymous',time=now();
  for(const [key,bucket]of buckets)if(time-bucket.start>=rateWindowMs)buckets.delete(key);
  let bucket=buckets.get(bucketKey);
  if(!bucket){if(buckets.size>=maxBuckets)return reply(res,503,'rate-capacity',Math.ceil(rateWindowMs/1000));bucket={start:time,count:0};buckets.set(bucketKey,bucket);}
  if(bucket.count>=rateLimit)return reply(res,503,'rate',Math.max(1,Math.ceil((rateWindowMs-(time-bucket.start))/1000)));
  bucket.count++;
  const release=capacity.acquire();if(!release)return reply(res,486,'concurrency');
  const tier=caller!==null&&allowed.has(caller)?'approved':'message-only';
  audit({event:'invite-accepted',active:capacity.active,callerPolicy,tier});
  try{return await run(Object.freeze({tier}));}finally{release();}
 };
}
module.exports={createCallGate,uriUser};
