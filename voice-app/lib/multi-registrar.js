'use strict';
const RegistrationLoop=require('./registration-loop');
class MultiRegistrar {
 constructor(srf,baseConfig){this.srf=srf;this.baseConfig=baseConfig;this.registrations=new Map();}
 registerAll(devices){for(const device of Object.values(devices))this.registerDevice(device);}
 registerDevice(device){const config={...this.baseConfig,extension:device.extension,auth_id:device.authId,password:device.password};this.sendRegister(device,config);}
 sendRegister(device,config){this.registrations.get(config.extension)?.stop();const loop=new RegistrationLoop(this.srf,config);this.registrations.set(config.extension,loop);loop.start();}
 getStatus(){return [...this.registrations.values()].map(loop=>loop.snapshot());}
 stop(){for(const loop of this.registrations.values())loop.stop();this.registrations.clear();}
}
module.exports=MultiRegistrar;
