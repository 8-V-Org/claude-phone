const fs=require('node:fs'),crypto=require('node:crypto'),net=require('node:net');
const dir='/run/phone-secrets';
async function ask(label,hidden=false){
 if(!process.stdin.isTTY)throw Error('Run with an interactive TTY');
 process.stdout.write(label+': ');process.stdin.setRawMode(true);process.stdin.resume();let s='';
 return new Promise(resolve=>{const onData=b=>{for(const c of b.toString()){
  if(c==='\u0003'){process.stdin.setRawMode(false);process.exit(130);}
  if(c==='\r'||c==='\n'){process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');resolve(s);return;}
  if(c==='\u007f'||c==='\b'){if(s.length){s=s.slice(0,-1);process.stdout.write('\b \b');}continue;}
  if(c>=' '){s+=c;process.stdout.write(hidden?'*':c);}
 }};process.stdin.on('data',onData);});
}
function save(name,data){fs.writeFileSync(dir+'/'+name+'.tmp',data,{mode:0o600});fs.renameSync(dir+'/'+name+'.tmp',dir+'/'+name);fs.chmodSync(dir+'/'+name,0o600);}
(async()=>{
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const token=process.env.OPENCLAW_GATEWAY_TOKEN;if(!token||token.includes('REPLACE_')||token.length<24)throw Error('Restore the real Gateway token in vps.env first');
 const c={domain:await ask('3CX SIP domain'),registrar:await ask('3CX registrar/SBC hostname or IP'),externalIp:await ask('THIS server media IP reachable by 3CX (not a Docker IP)'),extension:await ask('3CX extension'),authId:await ask('3CX authentication ID'),password:await ask('3CX SIP password',true)};
 c.sources=(await ask('Trusted PBX/SBC SOURCE IPs, comma-separated (no CIDRs)')).split(',').map(s=>s.trim()).filter(Boolean);
 c.callers=(await ask('Allowed caller extensions/numbers, comma-separated')).split(',').map(s=>s.trim()).filter(Boolean);
 if(net.isIP(c.externalIp)!==4||!c.sources.length||!c.sources.every(net.isIP)||!c.callers.length||!/^\d+$/.test(c.extension)||!c.password)throw Error('Invalid or incomplete phone configuration');
 const google=await ask('Paid Gemini API key (hidden)',true),openai=await ask('Optional paid OpenAI API key; Enter to omit (hidden)',true);
 const mode=process.env.PHONE_VOICE_MODE||'live';
 if((mode==='live'||process.env.STT_PROVIDER==='gemini'||process.env.TTS_PROVIDER==='gemini')&&!google)throw Error('Gemini key required for the selected Live or batch Gemini mode');
 if(mode==='batch'&&(process.env.STT_PROVIDER==='openai'||process.env.TTS_PROVIDER==='openai')&&!openai)throw Error('OpenAI key required for the selected batch OpenAI provider');
 save('phone.json',JSON.stringify(c,null,2));save('media-ip',c.externalIp);save('gemini-key',google);save('openai-key',openai);
 for(const name of ['bridge-token','drachtio-secret','freeswitch-secret'])if(!fs.existsSync(dir+'/'+name))save(name,crypto.randomBytes(32).toString('hex'));
 save('gateway-token',token);
 console.log('Configuration stored in protected host-mounted files. No credentials printed.');
})().catch(e=>{console.error(e.message);process.exit(1)});
