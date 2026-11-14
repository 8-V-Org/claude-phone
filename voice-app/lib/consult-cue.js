'use strict';
// Private working indicator only: no model reasoning/progress text is spoken.
// Paced 24kHz mono PCM, subordinate to real speech; no extra provider request.
class ConsultCue {
 constructor({now=Date.now,onEvent=()=>{},delayMs=750,periodMs=2500,pulseMs=100,amplitude=650}={}){Object.assign(this,{now,onEvent,delayMs,periodMs,pulseMs,amplitude});this.active=false;this.started=false;this.frames=0;}
 start(){this.active=true;this.started=false;this.startAt=this.now()+this.delayMs;this.frames=0;this.speechMs=0;}
 stop(reason='complete'){if(!this.active)return;this.active=false;if(this.started)this.onEvent('consult-cue-stop',{reason,frames:this.frames});}
 observeInput(pcm){if(!this.active||!pcm.length)return false;let energy=0;for(let i=0;i+1<pcm.length;i+=2){const sample=pcm.readInt16LE(i);energy+=sample*sample;}const rms=Math.sqrt(energy/(pcm.length/2));this.speechMs=rms>900?(this.speechMs||0)+pcm.length/32:0;if(this.speechMs>=60){this.stop('caller-speech');return true;}return false;}
 frame(){if(!this.active||this.now()<this.startAt)return null;if(!this.started){this.started=true;this.onEvent('consult-cue-start',{});}
  const b=Buffer.alloc(960),phase=(this.now()-this.startAt)%this.periodMs;
  for(let i=0;i<480;i++){const t=phase+i/24;if(t<this.pulseMs){const envelope=Math.min(1,t/10,(this.pulseMs-t)/10);b.writeInt16LE(Math.round(this.amplitude*Math.max(0,envelope)*Math.sin(2*Math.PI*440*t/1000)),i*2);}}
  this.frames++;return b;
 }
}
module.exports={ConsultCue};
