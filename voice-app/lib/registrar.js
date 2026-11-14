'use strict';
const RegistrationLoop=require('./registration-loop');
class Registrar {
 constructor(srf,config){this.loop=new RegistrationLoop(srf,config);}
 start(){this.loop.start();}
 stop(){this.loop.stop();}
 isRegistered(){return this.loop.snapshot().registered;}
 getStatus(){return this.loop.snapshot();}
}
module.exports=Registrar;
