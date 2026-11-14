'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('../lib/drachtio-byte-framing').installDrachtioByteFraming();
const WireProtocol=require('drachtio-srf/lib/wire-protocol');
test('byte-level TCP splits preserve multibyte UTF8 and invalid prefixes fail closed',()=>{
 const wp=new WireProtocol({}),socket={},got=[];wp.on('msg',(_,m)=>got.push(m));
 const input=Buffer.from(frame('sip|☎ · 📞')+frame('next|ok'));
 for(const byte of input)wp._onData(socket,Buffer.from([byte]));
 assert.deepEqual(got,['sip|☎ · 📞','next|ok']);
 for(const bad of ['x#data','123456','0#','-1#','1x#']){
  const p=new WireProtocol({});assert.throws(()=>p._onData({},bad),/Invalid Drachtio frame/);
 }
});
const frame=s=>Buffer.byteLength(s,'utf8')+'#'+s;
test('Drachtio UTF8 SIP response is delivered immediately without consuming next control frame',()=>{
 const wp=new WireProtocol({}),socket={},got=[];wp.on('msg',(_,m)=>got.push(m));
 const response='response|200 OK|Contact: "AI · Phone" <sip:30911@pbx.invalid>';
 wp._onData(socket,frame(response));assert.deepEqual(got,[response]);
 wp._onData(socket,frame('next|OK'));assert.deepEqual(got,[response,'next|OK']);
});
test('Drachtio byte framing tolerates split prefixes and coalesced UTF8 frames',()=>{
 const wp=new WireProtocol({}),socket={},got=[];wp.on('msg',(_,m)=>got.push(m));
 const input=frame('response|☎')+frame('ok|·')+frame('ASCII');
 for(const char of input)wp._onData(socket,char);
 assert.deepEqual(got,['response|☎','ok|·','ASCII']);
});
