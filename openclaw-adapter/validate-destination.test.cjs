'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createOperations,derive}=require('./phone-operations.cjs');
function send(res,status,body){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));}
async function body(req){const chunks=[];for await(const c of req)chunks.push(c);return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
test('validate dry-run normalizes 10/11-digit and +E.164 and does not require a worker or occupy the slot',async t=>{
 const token='test-token';
 const handler=createOperations({bridgeToken:token,send,body,now:()=>1});
 const server=http.createServer((req,res)=>{handler(req,res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>server.close());
 const port=server.address().port;
 const op='Bearer '+derive(token,'phone-operator-v1');
 const post=async to=>{const r=await fetch('http://127.0.0.1:'+port+'/phone/jobs',{method:'POST',headers:{Authorization:op,'Content-Type':'application/json'},body:JSON.stringify({action:'validate',to})});return {status:r.status,body:await r.json()};};
 for(const to of ['617-444-9080','16174449080','+16174449080']){
  const r=await post(to);
  assert.equal(r.status,200);
  assert.equal(r.body.wouldDial,'+16174449080');
  assert.equal(r.body.dryRun,true);
  assert.equal(r.body.kind,'pstn');
 }
 const ext=await post('30910');
 assert.equal(ext.status,200);assert.equal(ext.body.wouldDial,'30910');assert.equal(ext.body.kind,'extension');
 const bad=await post('sip:evil@x');
 assert.equal(bad.status,400);
});
test('validate rejects international and blocked NPAs with a clear error and does not queue',async t=>{
 const token='test-token';
 const handler=createOperations({bridgeToken:token,send,body,now:()=>1});
 const server=http.createServer((req,res)=>{handler(req,res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>server.close());
 const port=server.address().port;
 const op='Bearer '+derive(token,'phone-operator-v1');
 const post=async to=>{const r=await fetch('http://127.0.0.1:'+port+'/phone/jobs',{method:'POST',headers:{Authorization:op,'Content-Type':'application/json'},body:JSON.stringify({action:'validate',to})});return {status:r.status,body:await r.json()};};
 const intl=await post('+442071838750');
 assert.equal(intl.status,400);assert.match(String(intl.body.error||''),/International destinations are not permitted/);
 const jam=await post('8765551212');
 assert.equal(jam.status,400);assert.match(String(jam.body.error||''),/NPA 876/);
});
