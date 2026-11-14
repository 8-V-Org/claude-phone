'use strict';
// No extra retry library: owns SIP transaction, refresh and watchdog timers together.
class RegistrationLoop {
 constructor(srf,config,{log=console.log,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  Object.assign(this,{srf,config,log,now,setTimer,clearTimer});this.stopped=true;this.timer=null;this.watchdog=null;this.generation=0;this.failures=0;this.state={extension:config.extension,status:'stopped',expiresAt:null,lastSuccessAt:null,lastStatus:null,nextAttemptAt:null};
 }
 snapshot(){return {...this.state,registered:!this.stopped&&this.state.expiresAt>this.now()};}
 emit(){this.log('[REGISTRATION_STATE] '+JSON.stringify(this.snapshot()));}
 start(){if(!this.stopped)return;this.stopped=false;this.attempt();const check=()=>{if(this.stopped)return;this.emit();if(!this.timer&&!this.watchdog)this.attempt();this.healthTimer=this.setTimer(check,30000);};this.healthTimer=this.setTimer(check,30000);}
 stop(){this.stopped=true;this.generation++;this.clearTimer(this.timer);this.clearTimer(this.watchdog);this.clearTimer(this.healthTimer);this.timer=this.watchdog=this.healthTimer=null;this.state.status='stopped';this.state.nextAttemptAt=null;this.emit();}
 schedule(seconds,status){if(this.stopped)return;this.clearTimer(this.timer);this.state.status=status;this.state.nextAttemptAt=this.now()+seconds*1000;this.emit();this.timer=this.setTimer(()=>{this.timer=null;this.attempt();},seconds*1000);}
 attempt(){
  if(this.stopped)return;this.clearTimer(this.timer);this.clearTimer(this.watchdog);const generation=++this.generation;let settled=false;
  this.state.status='registering';this.state.nextAttemptAt=null;
  const finish=(status,res)=>{if(settled||this.stopped||generation!==this.generation)return;settled=true;this.clearTimer(this.watchdog);this.watchdog=null;this.state.lastStatus=status;
   if(status===200){
    let expiry=Number(this.config.expiry)||300;const contact=res.get('Contact'),expires=res.get('Expires');const match=typeof contact==='string'&&contact.match(/expires\s*=\s*"?(\d+)/i);const granted=match?Number(match[1]):expires!==undefined&&expires!==null&&expires!==''?Number(expires):expiry;
    if(Number.isFinite(granted)&&granted>=0)expiry=granted;
    if(expiry>0&&expiry<=86400){this.failures=0;this.state.lastSuccessAt=this.now();this.state.expiresAt=this.now()+expiry*1000;this.log('[MULTI-REGISTRAR] SUCCESS - Registered as ext '+this.config.extension);this.schedule(Math.max(0.1,Math.floor(expiry*0.8*1000)/1000),'registered');return;}
    this.state.expiresAt=null;
   }
   this.failures++;const seconds=Math.min(60,5*2**Math.min(this.failures-1,4));this.log('[MULTI-REGISTRAR] REGISTER final '+status+'; retry in '+seconds+'s');this.schedule(seconds,'retrying');
  };
  // Starts before request callback, so a missing callback is covered too.
  this.watchdog=this.setTimer(()=>finish('timeout'),30000);this.emit();
  const c=this.config,port=c.local_port||5060;
  try{this.srf.request('sip:'+c.registrar+':'+(c.registrar_port||5060)+';transport=udp',{method:'REGISTER',headers:{From:'<sip:'+c.extension+'@'+c.domain+'>',To:'<sip:'+c.extension+'@'+c.domain+'>',Contact:'<sip:'+c.extension+'@'+(c.local_address||'localhost')+':'+port+'>;expires='+(c.expiry||300),Expires:String(c.expiry||300),'User-Agent':'OpenClaw-Phone/1.0'},auth:{username:c.auth_id,password:c.password}},(err,req)=>{
   if(this.stopped||settled||generation!==this.generation)return;
   if(err||!req)return finish('request-error');
   req.on('response',res=>{if(res.status>=200)finish(res.status,res);});req.on('error',()=>finish('transport-error'));
  });}catch{finish('exception');}
 }
}
module.exports=RegistrationLoop;
