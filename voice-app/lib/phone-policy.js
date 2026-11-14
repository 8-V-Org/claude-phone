'use strict';
const MAX_CALL_DURATION_MS=1200000;
function number(value,fallback,min,max,name){const n=value===undefined||value===''?fallback:Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Invalid phone policy setting: '+name);return n;}
function durationMs(value,fallback,name){
 const raw=value===undefined||value===''?fallback:value;
 const n=Number(raw);
 if(!Number.isSafeInteger(n)||n<0||n>MAX_CALL_DURATION_MS)throw Error('Invalid phone policy setting: '+name);
 if(n!==0&&n<30000)throw Error('Invalid phone policy setting: '+name);
 return n;
}
function resolvePhonePolicy(config={},env=process.env){
 const explicit=env.PHONE_ALLOW_ANY_CALLER_FROM_TRUSTED_SOURCE;
 if(explicit!==undefined&&!['0','1'].includes(explicit))throw Error('Caller opt-in must be 0 or 1');
 if(config.callerPolicy!==undefined&&!['allowlist','trusted-source-any','tiered'].includes(config.callerPolicy))throw Error('Invalid configured caller policy');
 const configured=env.PHONE_CALLER_POLICY||config.callerPolicy||'allowlist';
 if(!['allowlist','trusted-source-any','tiered'].includes(configured))throw Error('Invalid caller policy');
 if(configured==='tiered'&&explicit==='1')throw Error('Tiering cannot be combined with any-caller mode');
 const callerPolicy=configured==='tiered'?'tiered':explicit===undefined?configured:(explicit==='1'?'trusted-source-any':'allowlist');
 return Object.freeze({callerPolicy,
  maxConcurrent:number(env.PHONE_MAX_CONCURRENT_CALLS??config.maxConcurrentCalls,1,1,4,'maxConcurrentCalls'),
  rateLimit:number(env.PHONE_RATE_LIMIT_PER_FROM??config.rateLimitPerFrom,6,1,60,'rateLimitPerFrom'),
  rateWindowMs:number(env.PHONE_RATE_WINDOW_MS??config.rateWindowMs,60000,1000,300000,'rateWindowMs'),
  maxDurationMs:durationMs(env.PHONE_MAX_CALL_DURATION_MS??config.maxCallDurationMs,1200000,'maxCallDurationMs')});
}
module.exports={resolvePhonePolicy,MAX_CALL_DURATION_MS};
