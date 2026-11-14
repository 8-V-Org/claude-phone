const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
process.env.PHONE_VOICE_MODE ||= 'live';
if (!['live','batch'].includes(process.env.PHONE_VOICE_MODE)) throw Error('PHONE_VOICE_MODE must be live or batch');
process.env.STT_PROVIDER ||= 'gemini'; process.env.TTS_PROVIDER ||= 'gemini';
if (process.env.PHONE_VOICE_MODE==='batch' && ![process.env.STT_PROVIDER,process.env.TTS_PROVIDER].every(p=>['gemini','openai'].includes(p))) throw Error('Batch speech providers must be gemini or openai');
const dir='/run/phone-secrets';
const config=JSON.parse(fs.readFileSync(path.join(dir,'phone.json'),'utf8'));
for(const k of ['domain','registrar','extension','authId','password','externalIp'])if(typeof config[k]!=='string'||!config[k])throw Error('Missing phone configuration: '+k);
if(!net.isIP(config.externalIp)||!Array.isArray(config.sources)||!config.sources.length||!config.sources.every(net.isIP)||!Array.isArray(config.callers)||!config.callers.length)throw Error('Explicit media IP, trusted SIP source IPs and caller allowlist required');
const secret=name=>fs.readFileSync(path.join(dir,name),'utf8').trim();
Object.assign(process.env,{SIP_DOMAIN:config.domain,SIP_REGISTRAR:config.registrar,SIP_EXTENSION:config.extension,SIP_AUTH_ID:config.authId,SIP_AUTH_PASSWORD:config.password,EXTERNAL_IP:config.externalIp,PHONE_SIP_SOURCES:config.sources.join(','),PHONE_ALLOWED_CALLERS:config.callers.join(','),DRACHTIO_SECRET:secret('drachtio-secret'),FREESWITCH_SECRET:secret('freeswitch-secret'),PHONE_BRIDGE_TOKEN_FILE:path.join(dir,'bridge-token')});
for(const [env,name] of [['GEMINI_API_KEY','gemini-key'],['OPENAI_API_KEY','openai-key']]){if(fs.existsSync(path.join(dir,name)))process.env[env]=secret(name);}
if((process.env.PHONE_VOICE_MODE==='live'||process.env.STT_PROVIDER==='gemini'||process.env.TTS_PROVIDER==='gemini')&&!process.env.GEMINI_API_KEY)throw Error('Google API key missing');
if(process.env.PHONE_VOICE_MODE==='batch'&&(process.env.STT_PROVIDER==='openai'||process.env.TTS_PROVIDER==='openai')&&!process.env.OPENAI_API_KEY)throw Error('OpenAI API key missing');
const device={name:'OpenClaw',extension:config.extension,authId:config.authId,password:config.password,voiceId:'Kore',prompt:'Provide concise spoken answers. Caller ID is not proof of owner authority.'};
fs.mkdirSync('/app/config',{recursive:true});fs.writeFileSync('/app/config/devices.json',JSON.stringify({[config.extension]:device}),{mode:0o600});
require('../index.js');
