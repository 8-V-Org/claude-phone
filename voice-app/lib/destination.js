'use strict';
// Caribbean and premium NPAs inside +1. US territories 340 (USVI) and 787/939 (PR) stay allowed.
const BLOCKED_NPAS=Object.freeze(['242','246','264','268','284','345','441','473','649','658','664','721','758','767','784','809','829','849','868','869','876','900','976']);
const MSG_INTL='International destinations are not permitted. Use a NANP +1 number (10-digit, 11-digit, or +1) or an internal extension.';
function blockedNpaMessage(npa){return 'NPA '+npa+' is a blocked Caribbean or premium code and is not permitted.';}
function policyReject(code,message){return {error:true,code,message};}
function acceptedDestination(n){return !!(n&&typeof n.to==='string'&&!n.error);}
function normalizeDestination(input,{allowPstn=false}={}){
 if(typeof input!=='string')return null;
 let raw=input.trim();
 if(!raw||/sip:/i.test(raw)||/[\r\n\t@;<>]/.test(raw))return null;
 raw=raw.replace(/[\s().-]/g,'');
 if(raw.startsWith('011'))raw='+'+raw.slice(3);
 else if(raw.startsWith('00'))raw='+'+raw.slice(2);
 if(/^\d{1,8}$/.test(raw))return {to:raw,kind:'extension'};
 if(allowPstn!==true)return null;
 let e164;
 if(/^\+[1-9]\d{1,14}$/.test(raw))e164=raw;
 else if(/^\d{10}$/.test(raw))e164='+1'+raw;
 else if(/^1\d{10}$/.test(raw))e164='+'+raw;
 else return null;
 if(!/^\+[1-9]\d{1,14}$/.test(e164))return null;
 if(!/^\+1\d{10}$/.test(e164))return policyReject('INTERNATIONAL_BLOCKED',MSG_INTL);
 const npa=e164.slice(2,5);
 if(BLOCKED_NPAS.includes(npa))return policyReject('NPA_BLOCKED',blockedNpaMessage(npa));
 return {to:e164,kind:'pstn'};
}
module.exports={normalizeDestination,acceptedDestination,BLOCKED_NPAS,MSG_INTL,blockedNpaMessage};
