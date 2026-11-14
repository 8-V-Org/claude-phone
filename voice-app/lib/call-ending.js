'use strict';
function scheduleEnding({deadlineAt,announce,noticeMs=10000,now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(!Number.isFinite(deadlineAt)||deadlineAt<=0)return ()=>{};
 if(typeof announce!=='function')throw Error('Invalid call deadline');
 const timer=setTimer(()=>{Promise.resolve().then(announce).catch(()=>{});},Math.max(0,deadlineAt-now()-noticeMs));
 return ()=>clearTimer(timer);
}
module.exports={scheduleEnding};
