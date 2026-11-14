'use strict';
const net=require('node:net');
function sipAddressUser(header){
 const raw=String(header||'');if(/[\r\n\x00]/.test(raw))return undefined;
 // Match the address URI, never a SIP-looking quoted display name.
 const named=raw.match(/^\s*(?:"(?:[^"\\]|\\.)*"|[^"<>]*)?\s*<\s*(sips?:[^<>\s]+)\s*>\s*(?:;[^<>]*)?$/i);
 const bare=raw.match(/^\s*(sips?:[^<>"\s]+)\s*$/i);
 return (named?.[1]||bare?.[1]||'').match(/^sips?:([+\d]+)@/i)?.[1];
}
let active=false;
function acquireCallSlot(){
 if(active)return null;active=true;let released=false;
 return ()=>{if(!released){released=true;active=false;}};
}
function createCallGate({sources=[],callers=[],extension,acquire=acquireCallSlot}={}){
 return async(req,res,run)=>{
  const source=String(req.source_address||'').replace(/^::ffff:/,'');
  const from=String(req.get('From')||''),to=String(req.get('To')||'');
  const caller=sipAddressUser(from),ext=sipAddressUser(to);
  if(!net.isIP(source)||!sources.includes(source)||ext!==extension){res.send(403);return;}
  const release=acquire();if(!release){res.send(486);return;}
  const callerTier=caller&&callers.includes(caller)?'approved':'message';
  console.info('[CALL_GATE] invite-accepted callerTier='+callerTier);
  try{return await run({callerTier});}finally{release();}
 };
}
module.exports={createCallGate,acquireCallSlot,sipAddressUser};
