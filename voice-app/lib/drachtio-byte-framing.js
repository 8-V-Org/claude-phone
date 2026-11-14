'use strict';
// drachtio-srf 4.5.43 counts Unicode code points in byte-length frames.
// A UTF-8 SIP Contact display name stalls a complete response, then consumes
// bytes from the next frame. Keep this compatibility fix local to the app.
function installDrachtioByteFraming(){
 const version=require('drachtio-srf/package.json').version;
 if(version!=='4.5.43')throw Error('Review Drachtio framing compatibility before changing the pinned client version');
 const WireProtocol=require('drachtio-srf/lib/wire-protocol');
 const installed=Symbol.for('hermes.phone.drachtio.byte-framing');
 if(WireProtocol.prototype[installed])return;
 WireProtocol.prototype._onData=function(socket,chunk){
  let state=this.mapIncomingMsg.get(socket);
  if(!state){state={incomingMsg:Buffer.alloc(0)};this.mapIncomingMsg.set(socket,state);}
  state.incomingMsg=Buffer.concat([state.incomingMsg,Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,'utf8')]);
  while(state.incomingMsg.length){
   const buffer=state.incomingMsg;
   const delimiter=buffer.indexOf(35);
   if(delimiter<0){
    if(buffer.length>5||! /^[0-9]*$/.test(buffer.toString('ascii')))throw Error('Invalid Drachtio frame prefix');
    return;
   }
   if(delimiter<1||delimiter>5||! /^[0-9]+$/.test(buffer.subarray(0,delimiter).toString('ascii')))throw Error('Invalid Drachtio frame prefix');
   const length=Number(buffer.subarray(0,delimiter).toString('ascii'));
   if(length<1||length>99999)throw Error('Invalid Drachtio frame length');
   const start=delimiter+1,end=start+length;
   if(buffer.length<end)return;
   // Advance before emitting: listeners may synchronously feed another frame.
   state.incomingMsg=buffer.subarray(end);
   this.emit('msg',socket,buffer.subarray(start,end).toString('utf8'),{length,start,fullMsg:buffer.toString('utf8')});
  }
 };
 WireProtocol.prototype[installed]=true;
}
module.exports={installDrachtioByteFraming};
