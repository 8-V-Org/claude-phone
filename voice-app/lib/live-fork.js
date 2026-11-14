'use strict';
// The installed mod_audio_fork stop_play branch ignores the stream name and
// looks up MY_BUG_NAME="audio_fork". Use that same bug name for start/stop/reset.
const BUG_NAME='audio_fork';
function bodyOf(response){return typeof response==='string'?response:response?.getBody?.()||'';}
async function checkCapability(endpoint){const text=bodyOf(await endpoint.api('help','uuid_audio_fork'));if(!/stop_play/.test(text)||!/bidirectional|bidrectional/i.test(text)||!/stream/i.test(text))throw Error('Installed audio-fork module lacks verified bidirectional streaming/stop_play interface');return true;}
async function stopPlayback(endpoint){const body=bodyOf(await endpoint.api('uuid_audio_fork',[endpoint.uuid,'stop_play']));if(!body.startsWith('+OK'))throw Error('uuid_audio_fork stop_play failed: '+body.trim());}
function startFork(endpoint,wsUrl){return endpoint.forkAudioStart({wsUrl,mixType:'mono',sampling:'16000',bugname:BUG_NAME,metadata:{},bidirectionalAudio:{enabled:'true',streaming:'true',sampleRate:'24000'}});}
function stopFork(endpoint){return endpoint.forkAudioStop(BUG_NAME);}
// Retire an existing fork: stop_play then stop. Failures are returned, not thrown,
// so a barge-in reset can continue (call stays up, stale audio is dropped).
async function retireFork(endpoint,wrap=p=>p){
 const errors=[];
 try{await wrap(stopPlayback(endpoint));}catch(error){errors.push(error);}
 try{await wrap(stopFork(endpoint));}catch(error){errors.push(error);}
 return errors;
}
module.exports={BUG_NAME,bodyOf,checkCapability,stopPlayback,startFork,stopFork,retireFork};
