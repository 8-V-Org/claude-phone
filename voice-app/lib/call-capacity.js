'use strict';
function createCapacity(max=1){let active=0;return {get active(){return active;},acquire(){if(active>=max)return null;active++;let released=false;return ()=>{if(!released){released=true;active--;}};}};}
let shared;function sharedCapacity(max){return shared||=(createCapacity(max));}
module.exports={createCapacity,sharedCapacity};
