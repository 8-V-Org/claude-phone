'use strict';
// drachtio-srf 4.5.43 already writes UTF-8 byte lengths, but receives/slices
// Unicode code points. Patch the receiver only; keep the pinned dependency.
const WireProtocol=require('drachtio-srf/lib/wire-protocol');
const version=require('drachtio-srf/package.json').version;
const installed=Symbol.for('openclaw.drachtio.byteFraming');
function drain(wire,socket,obj){
 for(;;){
  const b=obj.incomingMsg;if(!b.length)return;
  const hash=b.indexOf(35);if(hash<0){if(b.length>12||!/^[\r\n ]*\d{0,5}$/.test(b.toString('latin1')))throw Error('Invalid drachtio byte-frame header');return;}
  const header=b.subarray(0,hash).toString('latin1');if(!/^[\r\n ]*\d{1,5}$/.test(header))throw Error('Invalid drachtio byte-frame header');
  const length=Number(header.trim());if(length<1||length>99999)throw Error('Invalid drachtio byte-frame length');
  const start=hash+1;if(b.length<start+length)return;
  const payload=b.subarray(start,start+length);obj.incomingMsg=b.subarray(start+length);
  wire.emit('msg',socket,payload.toString('utf8'),{length,start,fullMsg:b.toString('utf8')});
 }
}
function install(){
 if(WireProtocol.prototype[installed])return false;
 if(version!=='4.5.43')throw Error('Review drachtio byte-framing patch for changed dependency version');
 const original=WireProtocol.prototype.installListeners;
 WireProtocol.prototype.installListeners=function(socket){
  if(socket.readableEncoding)throw Error('Drachtio transport must be byte-oriented before listener installation');
  const setEncoding=socket.setEncoding;socket.setEncoding=function(encoding){if(encoding==='utf8')return this;return setEncoding.call(this,encoding);};
  try{return original.call(this,socket);}finally{socket.setEncoding=setEncoding;}
 };
 WireProtocol.prototype._onData=function(socket,chunk){
  try{
   if(!Buffer.isBuffer(chunk))throw Error('Drachtio transport received decoded text instead of bytes');
   let obj=this.mapIncomingMsg.get(socket);if(!obj){obj={incomingMsg:Buffer.alloc(0),length:-1};this.mapIncomingMsg.set(socket,obj);}
   obj.incomingMsg=Buffer.concat([obj.incomingMsg,chunk]);drain(this,socket,obj);
  }catch(error){this.mapIncomingMsg.delete(socket);socket.destroy(error);}
 };
 WireProtocol.prototype.processMessageBuffer=function(socket,obj){drain(this,socket,obj);};
 Object.defineProperty(WireProtocol.prototype,installed,{value:true});return true;
}
module.exports={install};
