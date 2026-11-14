'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {startLiveServices}=require('../lib/live-services');
test('live service starts private control API with shared store and classifies outbound callee',async()=>{
 let captured;const runs=[],store={save:async()=>({id:'saved'})},env={PHONE_ALLOWED_CALLERS:'1001,1002',PHONE_BRIDGE_TOKEN_FILE:'/unused'};
 const api={close:()=>{}};const serverFactory=async o=>{captured=o;return api;};
 const out=await startLiveServices({srf:{},getMediaServer:()=> 'media',audioForkServer:{},wsPort:3001,port:0,env,token:'test-only',messageStore:store,serverFactory,runCall:(...x)=>runs.push(x)});
 assert.equal(out,api);assert.equal(captured.messageStore,store);assert.equal(captured.host,'127.0.0.1');assert.equal(captured.socketPath,'/app/messages/phone-api.sock');assert.equal(captured.allowPstn,false);
 await captured.runCall('ep','dialog','id',{to:'1001'});assert.equal(runs[0][3].callerTier,'approved');
 await captured.runCall('ep','dialog','id2',{to:'1003'});assert.equal(runs[1][3].callerTier,'message');assert.equal(runs[1][3].messageStore,store);
});
