'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {requestPhoneAPI}=require('../phone-api.cjs');
test('phone control client reads token privately and sends health/probe/dial/validate/status over Unix socket',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'phone-client-'));const socketPath=path.join(dir,'api.sock'),tokenFile=path.join(dir,'token');await fs.writeFile(tokenFile,'test-only-token\n',{mode:0o600});
 const seen=[];const server=http.createServer((req,res)=>{let b='';req.on('data',x=>b+=x);req.on('end',()=>{seen.push({path:req.url,method:req.method,auth:req.headers.authorization,body:b});res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');});});
 await new Promise(r=>server.listen(socketPath,r));t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 for(const [command,value] of [['health'],['probe'],['dial','30911'],['validate','617-444-9080'],['status','test-call'],['hangup','test-call']])assert.deepEqual(await requestPhoneAPI(command,value,{socketPath,tokenFile}),{ok:true});
 assert.deepEqual(seen.map(x=>x.path),['/health','/api/messages/probe','/api/outbound-call','/api/outbound-call','/api/outbound-call/test-call','/api/outbound-call/test-call/hangup']);
 assert.equal(seen[2].body,'{"to":"30911"}');
 assert.equal(seen[3].body,'{"to":"+16174449080","dryRun":true}');
 assert.ok(seen.every(x=>x.auth==='Bearer test-only-token'));
 await assert.rejects(requestPhoneAPI('dial','sip:evil',{socketPath,tokenFile}),/destination/i);
});
