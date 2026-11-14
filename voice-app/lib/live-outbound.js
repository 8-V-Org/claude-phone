'use strict';
const http = require('node:http');
const { createHash, timingSafeEqual, randomUUID } = require('node:crypto');
const { normalizeDestination, acceptedDestination } = require('./destination');
async function createLiveOutboundServer({ srf, getMediaServer, runCall, token, host = '127.0.0.1', port = 3000, env = process.env, maxBodyBytes = 4096, maxRecords = 1000, setupTimeoutMs = 30000, maxCallMs = require('./call-limits').MAX_CALL_MS, allowPstn = false, acquire = require('./call-gate').acquireCallSlot, messageStore, socketPath }) {
 const net = require('node:net');
 if (!(host === '::1' || (net.isIP(host) === 4 && host.startsWith('127.')))) throw Error('Loopback listener required');
 if (typeof token !== 'string' || !token.length || /\s/.test(token)) throw Error('Bearer token required');
 if ([maxRecords,setupTimeoutMs].some(value=>!Number.isInteger(value) || value < 1 || value > 2147483647) || !Number.isInteger(maxCallMs) || maxCallMs < 0 || maxCallMs > 2147483647) throw Error('Positive finite bounds required');
 if (typeof srf?.createUAC !== 'function' || typeof getMediaServer !== 'function' || typeof runCall !== 'function' || typeof acquire !== 'function') throw Error('Call dependencies required');
 const validHost = value => typeof value === 'string' && value.length <= 253 && (/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)$/.test(value) || /^\[[a-fA-F0-9:]+\]$/.test(value));
 if (!validHost(env.SIP_REGISTRAR || env.SIP_DOMAIN) || !validHost(env.SIP_DOMAIN || env.SIP_REGISTRAR) || !/^\d{1,8}$/.test(env.SIP_EXTENSION || '') || !env.SIP_AUTH_ID || !env.SIP_AUTH_PASSWORD || (env.SIP_REGISTRAR_PORT !== undefined && (!/^\d+$/.test(env.SIP_REGISTRAR_PORT) || +env.SIP_REGISTRAR_PORT < 1 || +env.SIP_REGISTRAR_PORT > 65535))) throw Error('SIP configuration incomplete or invalid');
 const digest = value => createHash('sha256').update(value).digest();
 const expected = digest(token), calls = new Map(), jobs = new Set(), stoppers = new Map();
 const reply = (res, status, value) => {res.writeHead(status, {'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 const bounded = async (operation, ms) => {
  if (!Number.isInteger(ms) || ms <= 0) return operation;
  let timer;
  try {return await Promise.race([operation, new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Call deadline exceeded')),ms);})]);}
  finally {clearTimeout(timer);}
 };
 const destroy = async resource => {
  try {if (resource && !resource.destroyed) await bounded(Promise.resolve().then(()=>resource.destroy()),setupTimeoutMs);} catch {}
 };
 async function execute(record, release) {
  let endpoint, dialog, request, onDestroy, stopped = false, cancelled = false, stopRequested=false, rejectStop;
  const stopSignal=new Promise((_,reject)=>rejectStop=reject);
  stoppers.set(record.callId,()=>{stopRequested=true;stopped=true;cancel();rejectStop(Error('Call stopped'));});
  const cancel = () => {
   if (!request || cancelled || dialog) return;
   cancelled = true;
   try {Promise.resolve(request.cancel()).catch(()=>{});} catch {}
  };
  const resource = async promise => {
   const value = await promise;
   if (stopped) {await destroy(value);throw Error('Call setup expired');}
   return value;
  };
  try {
   record.status = 'dialing';
   await bounded(Promise.race([stopSignal,(async()=>{
    const mediaServer = await getMediaServer();
    if (stopped) return;
    endpoint = await resource(mediaServer.createEndpoint());
    dialog = await resource(srf.createUAC(`sip:${record.to}@${env.SIP_DOMAIN || env.SIP_REGISTRAR}`, {
    localSdp:endpoint.local.sdp,
    proxy:`sip:${env.SIP_REGISTRAR || env.SIP_DOMAIN}:${env.SIP_REGISTRAR_PORT || 5060}`,
    headers:{From:`<sip:${env.SIP_EXTENSION}@${env.SIP_DOMAIN || env.SIP_REGISTRAR}>`, 'X-Call-ID':record.callId},
    auth:{username:env.SIP_AUTH_ID,password:env.SIP_AUTH_PASSWORD}
    }, {cbRequest:(error,req)=>{if (!error && req) {request=req;if(stopped) cancel();}}}));
    await endpoint.modify(dialog.remote.sdp);
   })()]),setupTimeoutMs);
   record.status = 'active';
   const ended = new Promise(resolve=>{onDestroy=resolve;dialog.once?.('destroy',onDestroy);if(dialog.destroyed) resolve();});
   await bounded(Promise.race([stopSignal,Promise.resolve().then(()=>runCall(endpoint, dialog, record.callId, {to:record.to})),ended]),maxCallMs);
   record.status = 'completed';
  } catch {record.status = stopRequested?'cancelled':'failed'; if(!stopRequested)record.error = 'call_failed';}
  finally {
   stopped = true;
   stoppers.delete(record.callId);
   if (onDestroy) dialog.removeListener?.('destroy',onDestroy);
   cancel();
   await Promise.all([destroy(dialog),destroy(endpoint)]);
   release();
  }
 }
 const handler = async (req, res) => {
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
  if (!timingSafeEqual(digest(match ? match[1] : ''), expected) || !match) return reply(res,401,{error:'unauthorized'});
  if (req.method === 'GET' && req.url === '/health') return reply(res,200,{version:1,messageStore:{available:typeof messageStore?.save === 'function'},activeOutbound:jobs.size,allowPstn:allowPstn===true});
  if (req.method === 'GET' && req.url.startsWith('/api/outbound-call/')) {
   const record = calls.get(req.url.slice('/api/outbound-call/'.length));
   return reply(res,record ? 200 : 404,record || {error:'not_found'});
  }
  const probe = req.url === '/api/messages/probe';
  const hangup = /^\/api\/outbound-call\/([a-f0-9-]{36})\/hangup$/.exec(req.url);
  if (req.method !== 'POST' || (!probe && !hangup && req.url !== '/api/outbound-call')) return reply(res,404,{error:'not_found'});
  let text = '', bytes = 0;
  try {
   for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) {req.resume();return reply(res,413,{error:'body_too_large'});}
    text += chunk;
   }
  } catch {return reply(res,400,{error:'invalid_body'});}
  let body;
  try {body = JSON.parse(text);} catch {return reply(res,400,{error:'invalid_json'});}
  if(hangup){
   if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length)return reply(res,400,{error:'invalid_hangup'});
   const stop=stoppers.get(hangup[1]);if(!stop)return reply(res,404,{error:'active_call_not_found'});
   stop();return reply(res,202,{callId:hangup[1],status:'stopping'});
  }
  if (probe) {
   if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length) return reply(res,400,{error:'invalid_probe'});
   try {
    const result = await messageStore?.save({name:'Deployment probe',callback:'not applicable',reason:'Owner-authorized deployment storage verification',consent:true});
    if (typeof result?.id !== 'string' || !result.id) throw Error('No saved identifier');
    return reply(res,201,{id:result.id});
   } catch {return reply(res,503,{error:'message_store_unavailable'});}
  }
  if (!body || Array.isArray(body) || typeof body !== 'object' || typeof body.to !== 'string' || Object.keys(body).some(key=>key!=='to' && key!=='dryRun') || (body.dryRun!==undefined && body.dryRun!==true && body.dryRun!==false)) return reply(res,400,{error:'invalid_destination'});
  const dest = normalizeDestination(body.to,{allowPstn});
  if (dest && dest.error) return reply(res,400,{error:dest.code==='NPA_BLOCKED'?'blocked_npa':'international_blocked',message:dest.message});
  if (!acceptedDestination(dest)) return reply(res,400,{error:'invalid_destination'});
  if (body.dryRun === true) return reply(res,200,{ok:true,wouldDial:dest.to,kind:dest.kind,allowPstn:allowPstn===true,dryRun:true});
  const {to} = dest;
  if (calls.size >= maxRecords) {
   const oldest = [...calls].find(([,record]) => record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled');
   if (!oldest) return reply(res,503,{error:'capacity'});
   calls.delete(oldest[0]);
  }
  const release = acquire();
  if (!release) return reply(res,409,{error:'call_busy'});
  const record = {callId:randomUUID(),to,status:'accepted'};calls.set(record.callId,record);
  reply(res,202,record);
  const job = execute(record, release); jobs.add(job);job.finally(()=>jobs.delete(job));
 };
 const safeHandler = (req,res) => {handler(req,res).catch(()=>{if (!res.headersSent) reply(res,500,{error:'internal_error'});else res.destroy();});};
 const server = http.createServer(safeHandler);
 const close = listener => !listener?.listening ? Promise.resolve() : new Promise((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
 server.closeAsync = async () => {await Promise.all([close(server),close(server.socketServer)]);await Promise.allSettled([...jobs]);};
 const listen = (listener,...args) => new Promise((resolve,reject)=>{
  const onError=error=>{listener.removeListener('listening',onListening);reject(error);};
  const onListening=()=>{listener.removeListener('error',onError);resolve();};
  listener.once('error',onError);listener.once('listening',onListening);listener.listen(...args);
 });
 try {
  if (socketPath) {
   const fs = require('node:fs/promises'), path = require('node:path');
   if (!path.isAbsolute(socketPath)) throw Error('Absolute socket path required');
   // Refuse symlink ancestors; recover only our own refused sockets.
   let current = '/';
   for (const component of path.dirname(socketPath).split('/').filter(Boolean)) {
    current = path.join(current,component);
    if (!(await fs.lstat(current)).isDirectory()) throw Error('Unsafe socket directory');
   }
   let existing;
   try {existing = await fs.lstat(socketPath);} catch(error) {if(error.code !== 'ENOENT') throw error;}
   if (existing) {
    if (!existing.isSocket() || existing.uid !== process.getuid()) throw Error('Unsafe socket path');
    await new Promise((resolve,reject)=>{
     const probe = net.createConnection(socketPath);
     probe.setTimeout(1000);
     probe.once('connect',()=>{probe.destroy();reject(Error('Socket is live'));});
     probe.once('timeout',()=>{probe.destroy();reject(Error('Socket probe timed out'));});
     probe.once('error',error=>{probe.destroy();if(error.code === 'ECONNREFUSED') resolve();else reject(error);});
    });
    const current = await fs.lstat(socketPath);
    if (!current.isSocket() || current.uid !== process.getuid() || current.dev !== existing.dev || current.ino !== existing.ino) throw Error('Socket path changed');
    await fs.unlink(socketPath);
   }
   server.socketServer = http.createServer(safeHandler);
   await listen(server.socketServer,socketPath);
   await fs.chmod(socketPath,0o600);
  }
  await listen(server,port,host);
 } catch(error) {await Promise.all([close(server),close(server.socketServer)]);throw error;}
 return server;
}
module.exports = {createLiveOutboundServer};
