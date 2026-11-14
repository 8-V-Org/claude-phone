'use strict';
// A local waiting indicator, not agent progress or speech. Frames are generated
// on demand by playout, never queued ahead of speech or caller interruption.
class ThinkingCue {
 constructor(){this.active=false;this.sample=0;}
 start(){this.sample=0;this.active=true;}
 stop(){this.active=false;}
 nextFrame(){
  if(!this.active)return null;
  const frame=Buffer.alloc(960),rate=24000,period=rate*2,pulse=rate*0.12,ramp=rate*0.01;
  for(let i=0;i<480;i++,this.sample++){
   const phase=this.sample%period;
   if(phase<pulse){const envelope=Math.min(1,phase/ramp,(pulse-phase)/ramp);frame.writeInt16LE(Math.round(500*envelope*Math.sin(2*Math.PI*440*phase/rate)),i*2);}
  }
  return frame;
 }
}
module.exports={ThinkingCue};
