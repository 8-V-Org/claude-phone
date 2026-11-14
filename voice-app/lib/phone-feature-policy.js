'use strict';
const fs=require('node:fs'),path=require('node:path');
function fail(code,message){throw Object.assign(Error(message),{code});}
const defaults={call_park:'*0{orbit}',call_unpark:'*1{orbit}{ext}',call_pickup:'*20*{ext}',voicemail_leave:'*4{ext}',voicemail_check:'999',presence_available:'*30',presence_away:'*31',presence_dnd:'*32',presence_custom1:'*33',presence_custom2:'*34'};
const aliases={call_park:'park',call_unpark:'unpark',call_pickup:'pickup',voicemail_leave:'voicemailLeave',voicemail_check:'voicemailCheck',presence_custom1:'presence_lunch',presence_custom2:'presence_business_trip'};
function featurePolicy(config={}){
 const codes=config.dialCodes||{},dial=config.dialPolicy||{};if(!codes||typeof codes!=='object'||Array.isArray(codes)||!dial||typeof dial!=='object'||Array.isArray(dial))fail('DIAL_POLICY_INVALID','Invalid phone dial-code policy');
 function extension(value){if(typeof value!=='string'||!/^\d{2,8}$/.test(value))fail('INVALID_EXTENSION','Use an internal extension only');return value;}
 function target(value){
  const {normalizeDestination,acceptedDestination}=require('./destination');
  const allowPstn=dial.allowPstn===true||process.env.PHONE_OUTBOUND_ALLOW_PSTN==='true';
  const n=normalizeDestination(value,{allowPstn});
  if(n&&n.error)fail('DIAL_POLICY_DENIED',n.message);
  if(!acceptedDestination(n))fail('DIAL_POLICY_DENIED',allowPstn?'Use an internal extension, 10-digit, 11-digit, or +1 NANP destination; never add a trunk prefix':'PSTN requires PHONE_OUTBOUND_ALLOW_PSTN or dialPolicy.allowPstn; never add a trunk prefix and do not use a destination allowlist');
  if(n.to===config.extension)fail('SELF_TRANSFER','Cannot transfer to this assistant extension');
  if(n.kind==='extension'&&Array.isArray(dial.internalAllowlist)&&dial.internalAllowlist.length&&!dial.internalAllowlist.includes(n.to))fail('DIAL_POLICY_DENIED','Internal destination is not permitted');
  return n.to;
 }
 function code(name,values={}){
  let value=Object.hasOwn(codes,name)?codes[name]:aliases[name]&&Object.hasOwn(codes,aliases[name])?codes[aliases[name]]:defaults[name];
  if(value===false||value===null)fail('DIAL_CODE_DISABLED','This dial code is disabled');
  if(typeof value!=='string'||value.length>80||!/^[0-9*#{}a-z_]+$/i.test(value))fail('DIAL_POLICY_INVALID','Invalid configured dial-code template');
  if(value.includes('{orbit}')&&(values.orbit===undefined||!/^[1-9]$/.test(String(values.orbit))))fail('INVALID_ORBIT','Park orbit must be 1 through 9');
  if(values.ext)extension(values.ext);
  const rendered=value.replace(/\{orbit\}/g,values.orbit===undefined?'':String(values.orbit)).replace(/\{ext\}/g,values.ext||'');
  if(/[{}]/.test(rendered)||!/^\*?[0-9*#]{1,30}$/.test(rendered))fail('DIAL_POLICY_INVALID','Dial-code template could not be rendered');return rendered;
 }
 return {target,extension,code,defaults};
}
function loadFeatureConfig(file='/run/phone-secrets/phone.json'){const c=JSON.parse(fs.readFileSync(file,'utf8'));featurePolicy(c);return c;}
function voicemailPin(dir='/run/phone-secrets',config={}){const name=config.voicemailPinFile||'voicemail-pin';if(typeof name!=='string'||path.basename(name)!==name||!/^[a-z0-9._-]+$/i.test(name))fail('PIN_CONFIG_INVALID','Invalid voicemail PIN filename');const file=path.join(dir,name);if(!fs.existsSync(file))fail('PIN_NOT_CONFIGURED','Owner must add a protected voicemail-pin file before voicemail login');const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))fail('PIN_PERMISSIONS','Voicemail PIN must be a private regular file');const pin=fs.readFileSync(file,'utf8').trim();if(!/^\d{3,20}$/.test(pin))fail('PIN_CONFIG_INVALID','Invalid voicemail PIN format');return pin;}
module.exports={featurePolicy,loadFeatureConfig,voicemailPin,fail};
