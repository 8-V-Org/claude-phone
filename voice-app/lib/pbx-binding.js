'use strict';
const fs=require('node:fs');
function createPbxBinding({callerTier='message',srf,endpoint,dialog,mediaServer,env=process.env,readConfig,PbxClass,onSessionStart,onSessionEnd}={}){
 if(callerTier!=='approved')return null;
 readConfig??=()=>{try{return JSON.parse(fs.readFileSync(env.PHONE_CONFIG_FILE||'/run/phone-secrets/phone.json','utf8'));}catch(e){if(e.code==='ENOENT')return {};throw Error('Phone policy configuration unreadable');}};
 const config=readConfig();
 if(config.dialCodes!==undefined&&(!config.dialCodes||typeof config.dialCodes!=='object'||Array.isArray(config.dialCodes)))throw Error('Invalid dialCodes configuration');
 PbxClass??=require('./pbx-tools').PbxTools;
 const pbx=new PbxClass({callerTier,srf,endpoint,dialog,mediaServer,registrar:env.SIP_DOMAIN||env.SIP_REGISTRAR,extension:env.SIP_EXTENSION,auth:{username:env.SIP_AUTH_ID,password:env.SIP_AUTH_PASSWORD},dialCodes:config.dialCodes,allowPstn:env.PHONE_OUTBOUND_ALLOW_PSTN==='true',authorizePstn:destination=>{const n=require('./destination').normalizeDestination(destination,{allowPstn:env.PHONE_OUTBOUND_ALLOW_PSTN==='true'});return require('./destination').acceptedDestination(n);},onSessionStart,onSessionEnd,voicemailPinPath:env.PHONE_VOICEMAIL_PIN_FILE,xapiPath:'/run/phone-secrets/xapi.json'});
 return {declarations:pbx.declarations(),execute:(name,args)=>pbx.execute(name,args),close:()=>pbx.close()};
}
module.exports={createPbxBinding};
