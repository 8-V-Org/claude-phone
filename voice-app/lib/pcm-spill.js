'use strict';
// Ephemeral generated-output queue, not a call recording. No pathname survives
// construction; the kernel releases the anonymous file on close/process exit.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
class PcmSpill {
 constructor(capacity,{directory=os.tmpdir()}={}){
  if(!Number.isSafeInteger(capacity)||capacity<2||capacity%2)throw Error('Invalid PCM spill capacity');
  this.capacity=capacity;this.bytes=0;this.readAt=0;this.writeAt=0;this.fd=null;
  let dir,file;
  try{dir=fs.mkdtempSync(path.join(directory,'phone-playout-'));fs.chmodSync(dir,0o700);file=path.join(dir,'pcm');this.fd=fs.openSync(file,'wx+',0o600);fs.unlinkSync(file);file=null;fs.rmdirSync(dir);dir=null;}
  catch(error){if(this.fd!==null){try{fs.closeSync(this.fd);}catch{}this.fd=null;}if(file)try{fs.unlinkSync(file);}catch{}if(dir)try{fs.rmdirSync(dir);}catch{}throw Error('Private PCM spill unavailable');}
 }
 append(data){
  if(this.fd===null||data.length%2||data.length>this.capacity-this.bytes)throw Error('PCM spill capacity exceeded');
  let offset=0;
  while(offset<data.length){const size=Math.min(data.length-offset,this.capacity-this.writeAt);const n=fs.writeSync(this.fd,data,offset,size,this.writeAt);if(n<=0)throw Error('PCM spill write failed');offset+=n;this.writeAt=(this.writeAt+n)%this.capacity;this.bytes+=n;}
 }
 peek(size){
  if(this.fd===null||size>this.bytes||size<0)throw Error('PCM spill read invalid');
  const out=Buffer.alloc(size);let offset=0,at=this.readAt;
  while(offset<size){const count=Math.min(size-offset,this.capacity-at);const n=fs.readSync(this.fd,out,offset,count,at);if(n<=0)throw Error('PCM spill read failed');offset+=n;at=(at+n)%this.capacity;}
  return out;
 }
 consume(size){if(size<0||size>this.bytes||size%2)throw Error('PCM spill consume invalid');this.readAt=(this.readAt+size)%this.capacity;this.bytes-=size;}
 close(){if(this.fd!==null){const fd=this.fd;this.fd=null;fs.closeSync(fd);}this.bytes=0;}
}
module.exports={PcmSpill};
