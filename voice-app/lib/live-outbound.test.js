'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {EventEmitter}=require('node:events');
const {createLiveOutboundServer}=require('./live-outbound');
const env={SIP_EXTENSION:'123',SIP_AUTH_ID:'test-auth',SIP_AUTH_PASSWORD:'test-password',SIP_DOMAIN:'pbx.example',SIP_REGISTRAR:'registrar.example',SIP_REGISTRAR_PORT:'5061'};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function fixture(t,overrides={}){
 const events=[],done=deferred();
 const endpoint={local:{sdp:'local-sdp'},modify:async sdp=>events.push(['modify',sdp]),destroy:async()=>events.push(['endpoint-destroy'])};
 const dialog=Object.assign(new EventEmitter(),{remote:{sdp:'remote-sdp'},destroy:async()=>events.push(['dialog-destroy'])});
 const server=await createLiveOutboundServer({srf:{createUAC:async(...args)=>{events.push(['dial',...args]);return dialog;}},getMediaServer:()=>({createEndpoint:async()=>endpoint}),runCall:async(...args)=>{events.push(['run',...args]);await done.promise;},token:'test-token',port:0,env,...overrides});
 t.after(async()=>{done.resolve();await server.closeAsync();});
 const request=(body,token='test-token',path='/api/outbound-call',method='POST')=>new Promise((resolve,reject)=>{
 const req=http.request({host:'127.0.0.1',port:server.address().port,path,method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}},res=>{let text='';res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);req.end(typeof body==='string'?body:body===undefined?undefined:JSON.stringify(body));});
 return {server,request,events,done,endpoint,dialog};
}
test('authenticated hangup stops an active call and releases its slot',async t=>{
 const {request,events}=await fixture(t);
 const call=await request({to:'456'});await tick();
 const route='/api/outbound-call/'+call.body.callId+'/hangup';
 assert.equal((await request({},'wrong',route)).status,401);
 assert.equal((await request({},'test-token',route)).status,202);await tick();
 assert.equal((await request(undefined,'test-token','/api/outbound-call/'+call.body.callId,'GET')).body.status,'cancelled');
 assert.equal(events.filter(x=>x[0]==='dialog-destroy').length,1);
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('bounds records by pruning oldest finished calls and refuses capacity without acquiring',async t=>{
 let acquired=0;
 const {request,done}=await fixture(t,{maxRecords:2,acquire:()=>{acquired++;return ()=>{};}});
 const first=await request({to:'451'}),second=await request({to:'452'});
 const full=await request({to:'453'});
 assert.equal(full.status,503);assert.equal(full.body.error,'capacity');assert.equal(acquired,2);
 done.resolve();await tick();
 const third=await request({to:'453'});assert.equal(third.status,202);await tick();
 assert.equal((await request(undefined,'test-token','/api/outbound-call/'+first.body.callId,'GET')).status,404);
 assert.equal((await request(undefined,'test-token','/api/outbound-call/'+second.body.callId,'GET')).status,200);
 assert.equal((await request(undefined,'test-token','/api/outbound-call/'+third.body.callId,'GET')).status,200);
});
test('setup timeout sends SIP CANCEL, releases once and destroys late dialog without starting Live',async t=>{
 const pending=deferred();let options,cancels=0,releases=0,destroys=0;
 const {request,events}=await fixture(t,{setupTimeoutMs:20,acquire:()=>()=>releases++,srf:{createUAC:(uri,opts,callbacks)=>{options=callbacks;callbacks?.cbRequest(null,{cancel:()=>{cancels++;}});return pending.promise;}}});
 const accepted=await request({to:'456'});
 await delay(60);
 const status=await request(undefined,'test-token','/api/outbound-call/'+accepted.body.callId,'GET');
 pending.resolve({remote:{sdp:'late'},destroy:async()=>destroys++});await tick();
 assert.equal(status.body.status,'failed');assert.equal(status.body.error,'call_failed');
 assert.equal(typeof options.cbRequest,'function');assert.equal(cancels,1);assert.equal(releases,1);
 assert.equal(destroys,1);assert.equal(releases,1);assert.equal(events.filter(x=>x[0]==='run').length,0);
 assert.equal(events.filter(x=>x[0]==='endpoint-destroy').length,1);
});
test('bounds media discovery, allocation and modification, cleaning late resources',async t=>{
 for (const stage of ['discovery','allocation','modify']) {
  const pending=deferred();let released=0,destroyed=0;
  const endpoint={local:{sdp:'local'},modify:()=>stage==='modify'?pending.promise:Promise.resolve(),destroy:async()=>destroyed++};
  const media={createEndpoint:()=>stage==='allocation'?pending.promise:Promise.resolve(endpoint)};
  const f=await fixture(t,{setupTimeoutMs:15,acquire:()=>()=>released++,getMediaServer:()=>stage==='discovery'?pending.promise:media});
  const accepted=await f.request({to:'456'});await delay(50);
  const status=await f.request(undefined,'test-token','/api/outbound-call/'+accepted.body.callId,'GET');
  pending.resolve(stage==='discovery'?media:stage==='allocation'?endpoint:undefined);await tick();
  assert.equal(status.body.status,'failed',stage);assert.equal(released,1,stage);
  assert.equal(destroyed,stage==='discovery'?0:1,stage);
  assert.equal(f.events.filter(x=>x[0]==='run').length,0,stage);
 }
});
test('max call deadline cleans a hanging Live runner and passes destination context',async t=>{
 let released=0;
 const f=await fixture(t,{maxCallMs:20,acquire:()=>()=>released++});
 const accepted=await f.request({to:'456'});await delay(60);
 const status=await f.request(undefined,'test-token','/api/outbound-call/'+accepted.body.callId,'GET');
 assert.equal(status.body.status,'failed');assert.equal(released,1);
 assert.deepEqual(f.events.find(x=>x[0]==='run')[4],{to:'456'});
 assert.equal(f.events.filter(x=>x[0]==='dialog-destroy').length,1);
 assert.equal(f.events.filter(x=>x[0]==='endpoint-destroy').length,1);
 f.done.resolve();await tick();
 assert.equal((await f.request(undefined,'test-token','/api/outbound-call/'+accepted.body.callId,'GET')).body.status,'failed');
 assert.equal(released,1);
});
test('remote dialog destruction releases the slot even when Live is stuck',async t=>{
 let released=0;
 const f=await fixture(t,{acquire:()=>()=>released++});
 const accepted=await f.request({to:'456'});await tick();
 f.dialog.destroyed=true;f.dialog.emit('destroy');await tick();
 assert.equal(released,1);
 assert.equal(f.events.filter(x=>x[0]==='endpoint-destroy').length,1);
 assert.equal(f.dialog.listenerCount('destroy'),0);
 assert.equal((await f.request(undefined,'test-token','/api/outbound-call/'+accepted.body.callId,'GET')).body.status,'completed');
});
test('rejects invalid history and timer bounds',async()=>{
 const base={srf:{createUAC(){}},getMediaServer(){},runCall(){},token:'test-token',env,port:0};
 for(const key of ['maxRecords','setupTimeoutMs']) for(const value of [0,-1,NaN,Infinity,1.5,'20',2147483648]) {
  let server;
  try {server=await createLiveOutboundServer({...base,[key]:value});} catch {continue;}
  await server.closeAsync();assert.fail('invalid '+key+' accepted: '+value);
 }
 for(const value of [-1,NaN,Infinity,1.5,'20',2147483648]) {
  let server;
  try {server=await createLiveOutboundServer({...base,maxCallMs:value});} catch {continue;}
  await server.closeAsync();assert.fail('invalid maxCallMs accepted: '+value);
 }
 const allowed=await createLiveOutboundServer({...base,maxCallMs:0});
 await allowed.closeAsync();
});
test('dials registrar with extension credentials, bridges SDP, runs Live and reports actual lifecycle',async t=>{
 const {request,events,done}=await fixture(t);
 const accepted=await request({to:'456'});
 assert.equal(accepted.status,202);assert.equal(accepted.body.status,'accepted');
 assert.match(accepted.body.callId,/^[a-f0-9-]{36}$/);
 await tick();
 const dial=events.find(x=>x[0]==='dial');
 assert.equal(dial[1],'sip:456@pbx.example');
 assert.equal(dial[2].proxy,'sip:registrar.example:5061');
 assert.equal(dial[2].headers.From,'<sip:123@pbx.example>');
 assert.deepEqual(dial[2].auth,{username:'test-auth',password:'test-password'});
 assert.equal(dial[2].localSdp,'local-sdp');
 assert.deepEqual(events.find(x=>x[0]==='modify'),['modify','remote-sdp']);
 assert.equal(events.find(x=>x[0]==='run')[3],accepted.body.callId);
 const path='/api/outbound-call/'+accepted.body.callId;
 assert.equal((await request(undefined,'test-token',path,'GET')).body.status,'active');
 done.resolve();await tick();
 assert.equal((await request(undefined,'test-token',path,'GET')).body.status,'completed');
 assert.equal(events.filter(x=>x[0]==='endpoint-destroy').length,1);
 assert.equal(events.filter(x=>x[0]==='dialog-destroy').length,1);
});
test('rejects malformed, oversized or non-extension bodies without dialing',async t=>{
 const {request,events}=await fixture(t,{maxBodyBytes:128});
 for(const body of ['{','null','[]','{}','{"to":123}',JSON.stringify({to:'sip:456@evil'}),JSON.stringify({to:'456\r\nX: evil'}),JSON.stringify({to:'+15551234567'}),JSON.stringify({to:'1234567890123456'}),JSON.stringify({to:'456',allowPstn:true})]){
  assert.equal((await request(body)).status,400,body);
 }
 assert.equal((await request('x'.repeat(129))).status,413);
 assert.equal(events.length,0);
});
test('explicit server-only PSTN permission preserves exact E164 without prefix and normalizes NANP',async t=>{
 const {request,events,done}=await fixture(t,{allowPstn:true});
 const ten=await request({to:'555-123-4567',dryRun:true});
 assert.equal(ten.status,200);assert.equal(ten.body.wouldDial,'+15551234567');assert.equal(ten.body.kind,'pstn');
 const eleven=await request({to:'15551234567',dryRun:true});
 assert.equal(eleven.status,200);assert.equal(eleven.body.wouldDial,'+15551234567');
 assert.equal((await request({to:'+15551234567'})).status,202);await tick();
 assert.equal(events.find(x=>x[0]==='dial')[1],'sip:+15551234567@pbx.example');
 for(const to of ['+01234','+1','+1234567890123456']) assert.equal((await request({to})).status,400);
 const health=await request(undefined,'test-token','/health','GET');
 assert.equal(health.body.allowPstn,true);
 done.resolve();
});
test('dryRun validates destinations without dialing or taking the call slot',async t=>{
 const {request,events}=await fixture(t,{allowPstn:true,acquire:()=>{throw Error('slot must not be acquired');}});
 const ok=await request({to:'617-444-9080',dryRun:true});
 assert.equal(ok.status,200);
 assert.deepEqual(ok.body,{ok:true,wouldDial:'+16174449080',kind:'pstn',allowPstn:true,dryRun:true});
 const ext=await request({to:'30911',dryRun:true});
 assert.equal(ext.status,200);assert.equal(ext.body.wouldDial,'30911');assert.equal(ext.body.kind,'extension');
 assert.equal((await request({to:'sip:evil',dryRun:true})).status,400);
 assert.equal(events.length,0);
});
test('holds injected shared gate until Live and cleanup finish; rejects overlap',async t=>{
 let held=false,releases=0;
 const acquire=()=>{if(held)return null;held=true;return ()=>{held=false;releases++;};};
 const {request,done}=await fixture(t,{acquire});
 assert.equal((await request({to:'456'})).status,202);
 assert.equal((await request({to:'457'})).status,409);
 assert.equal(releases,0);done.resolve();await tick();
 assert.equal(releases,1);assert.equal((await request({to:'458'})).status,202);
});
test('busy inbound gate prevents media allocation',async t=>{
 const {request,events}=await fixture(t,{acquire:()=>null});
 assert.equal((await request({to:'456'})).status,409);assert.deepEqual(events,[]);
});
test('fails closed on unsafe listener, empty token and malformed SIP config',async()=>{
 const base={srf:{createUAC(){}},getMediaServer(){},runCall(){},token:'test-token',env,port:0};
 for(const overrides of [{host:'0.0.0.0'},{host:'localhost'},{token:''},{env:{...env,SIP_REGISTRAR:undefined,SIP_DOMAIN:undefined}},{env:{...env,SIP_AUTH_PASSWORD:''}},{env:{...env,SIP_DOMAIN:'pbx.example\r\nX: evil'}},{env:{...env,SIP_EXTENSION:'bad'}},{env:{...env,SIP_REGISTRAR_PORT:'0'}}]) {
  const promise=createLiveOutboundServer({...base,...overrides});
  let server;try{server=await promise;}catch{continue;}
  await server.closeAsync();assert.fail('unsafe configuration accepted: '+JSON.stringify(Object.keys(overrides)));
 }
});
test('cleans endpoint on SIP failure and reports failure without leaking error secrets',async t=>{
 const {request,events}=await fixture(t,{srf:{createUAC:async()=>{throw Error('test-password');}}});
 const accepted=await request({to:'456'});await tick();
 const status=await request(undefined,'test-token','/api/outbound-call/'+accepted.body.callId,'GET');
 assert.equal(status.body.status,'failed');assert.equal(status.body.error,'call_failed');
 assert.equal(events.filter(x=>x[0]==='endpoint-destroy').length,1);
 assert.equal(events.filter(x=>x[0]==='run').length,0);
});
test('cleans both resources and marks failure when media bridge fails',async t=>{
 let destroyed=0,ran=0;
 const {request,events}=await fixture(t,{getMediaServer:()=>({createEndpoint:async()=>({local:{sdp:'local'},modify:async()=>{throw Error('bridge');},destroy:async()=>destroyed++})}),runCall:async()=>ran++});
 const response=await request({to:'456'});await tick();
 assert.equal((await request(undefined,'test-token','/api/outbound-call/'+response.body.callId,'GET')).body.status,'failed');
 assert.equal(destroyed,1);assert.equal(ran,0);assert.equal(events.filter(x=>x[0]==='dialog-destroy').length,1);
});
test('authenticated health and fixed synthetic message probe never dial',async t=>{
 const saved=[];
 const {request,events}=await fixture(t,{messageStore:{save:async message=>{saved.push(message);return {id:'probe-id',path:'/private/not-returned'};}}});
 assert.equal((await request(undefined,'wrong','/health','GET')).status,401);
 const health=await request(undefined,'test-token','/health','GET');
 assert.equal(health.status,200);assert.equal(health.body.messageStore.available,true);assert.equal(health.body.activeOutbound,0);assert.equal(health.body.allowPstn,false);
 assert.equal((await request({},'wrong','/api/messages/probe')).status,401);
 const result=await request({},'test-token','/api/messages/probe');
 assert.equal(result.status,201);assert.deepEqual(result.body,{id:'probe-id'});
 assert.deepEqual(saved,[{name:'Deployment probe',callback:'not applicable',reason:'Owner-authorized deployment storage verification',consent:true}]);
 assert.equal((await request({name:'override'},'test-token','/api/messages/probe')).status,400);
 assert.deepEqual(events,[]);
});
test('probe reports unavailable or failed storage without claiming saved',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request({},'test-token','/api/messages/probe')).status,503);
 const g=await fixture(t,{messageStore:{save:async()=>{throw Error('private');}}});
 assert.deepEqual(await g.request({},'test-token','/api/messages/probe'),{status:503,body:{error:'message_store_unavailable'}});
});
test('optional Unix socket shares authenticated handler and has mode 0600',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path');
 const dir=await fs.mkdtemp('/opt/data/cache/scratch/phone-api-');t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const socketPath=path.join(dir,'api.sock');
 const {server}=await fixture(t,{socketPath});
 const stat=await fs.lstat(socketPath);assert.equal(stat.isSocket(),true);assert.equal(stat.mode&0o777,0o600);
 const response=await new Promise((resolve,reject)=>{
  const req=http.get({socketPath,path:'/health',headers:{Authorization:'Bearer test-token'}},res=>{let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));});req.on('error',reject);
 });
 assert.equal(response.status,200);assert.equal(response.body.version,1);assert.ok(server.socketServer);
});
test('recovers an owned stale Unix socket but leaves live and foreign sockets untouched',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net');
 const {spawnSync}=require('node:child_process');
 const dir=await fs.mkdtemp('/opt/data/cache/scratch/phone-api-');t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const socketPath=path.join(dir,'stale.sock');
 const child=spawnSync(process.execPath,['-e',"require('node:net').createServer().listen(process.argv[1],()=>process.exit(0))",socketPath]);
 assert.equal(child.status,0);assert.equal((await fs.lstat(socketPath)).isSocket(),true);
 const f=await fixture(t,{socketPath});assert.equal(f.server.socketServer.listening,true);
 const livePath=path.join(dir,'live.sock'),live=net.createServer(socket=>socket.end());
 await new Promise(resolve=>live.listen(livePath,resolve));t.after(()=>new Promise(resolve=>live.close(resolve)));
 const before=await fs.lstat(livePath);
 const base={srf:{createUAC(){}},getMediaServer(){},runCall(){},token:'test-token',env,port:0};
 await assert.rejects(createLiveOutboundServer({...base,socketPath:livePath}));
 assert.equal((await fs.lstat(livePath)).ino,before.ino);
 const lstat=fs.lstat;
 t.mock.method(fs,'lstat',async(...args)=>{const stat=await lstat(...args);if(args[0]===livePath) Object.defineProperty(stat,'uid',{value:process.getuid()+1});return stat;});
 await assert.rejects(createLiveOutboundServer({...base,socketPath:livePath}));
 assert.equal((await lstat(livePath)).ino,before.ino);
});
test('Unix socket refuses symlinks and non-sockets without unlinking',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path');
 const dir=await fs.mkdtemp('/opt/data/cache/scratch/phone-api-');t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'regular'),link=path.join(dir,'link');await fs.writeFile(file,'keep');await fs.symlink(file,link);
 for(const socketPath of [file,link]) {
  let server;try{server=await createLiveOutboundServer({srf:{createUAC(){}},getMediaServer(){},runCall(){},token:'test-token',env,port:0,socketPath});}catch{continue;}
  await server.closeAsync();assert.fail('unsafe socket path accepted');
 }
 assert.equal(await fs.readFile(file,'utf8'),'keep');assert.equal((await fs.lstat(link)).isSymbolicLink(),true);
});
test('requires bearer auth before accepting an outbound call',async t=>{
 const {request,events}=await fixture(t);
 assert.equal((await request({to:'456'},'wrong')).status,401);
 assert.equal(events.length,0);
});
