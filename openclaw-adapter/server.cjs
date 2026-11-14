// Dependency-free Node 22+ adapter for claude-phone's /ask contract.
// No Claude CLI subprocess, local model, or retained conversation transcript.
const http = require('node:http');
const { readFileSync } = require('node:fs');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const {derive,createOperations}=require('./phone-operations.cjs');

// Shared network namespaces cannot set Docker extra_hosts. Connect to loopback
// while retaining the real hostname for SNI and certificate verification.
function loopbackFetch(url,options={}) {
  if(url.protocol!=='https:')throw Error('TLS required');
  return new Promise((resolve,reject)=>{
    const req=require('node:https').request({hostname:'127.0.0.1',port:url.port||443,path:url.pathname,servername:url.hostname,method:options.method||'GET',headers:{...options.headers,Host:url.host},signal:options.signal},res=>{
      const parts=[];let size=0;
      res.on('data',b=>{size+=b.length;if(size>524288){res.destroy(Error('Gateway response too large'));return;}parts.push(b);});
      res.on('error',reject);res.on('end',()=>resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,json:async()=>JSON.parse(Buffer.concat(parts).toString())}));
    });
    req.on('error',reject);req.end(options.body);
  });
}

function fileSecret(name) {
  const file = process.env[name];
  if (!file) throw new Error(name + ' must name a protected secret file');
  const value = readFileSync(file, 'utf8').trim();
  if (value.length < 24) throw new Error(name + ' contains an invalid secret');
  return value;
}
function createBridge({ gatewayUrl, gatewayToken, bridgeToken, agent = 'phone', fetchImpl = fetch, timeoutMs = 90000 }) {
  const target = new URL('/v1/chat/completions', gatewayUrl);
  if (target.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
    throw new Error('Remote Gateway transport must use verified HTTPS');
  }
  if (!gatewayToken || !bridgeToken || bridgeToken.length < 24) throw new Error('Both tokens are required');
  const sessions = new Map();
  let busy = false;
  const ttl = 30 * 60 * 1000;
  const token = Buffer.from('Bearer ' + bridgeToken);
  const send = (res, code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  async function body(req) {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) throw Object.assign(new Error('Request too large'), { status: 413 });
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  }
  const operations=createOperations({bridgeToken,send,body});
  const server = http.createServer(async (req, res) => {
    if(await operations(req,res))return;
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { status: 'ok', backend: 'openclaw', upstreamVerified: false, gatewayTarget:{protocol:target.protocol,hostname:target.hostname,port:target.port||'443',loopbackTransport:fetchImpl===loopbackFetch}, approvedAgent:'main' });
    const approved=req.url==='/ask-approved';
    const expected=approved?Buffer.from('Bearer '+derive(bridgeToken,'phone-approved-consult-v1')):token;
    const supplied = Buffer.from(req.headers.authorization || '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(res, 401, { success: false, error: 'Unauthorized' });
    if (req.method !== 'POST' || !['/ask', '/ask-approved', '/end-session'].includes(req.url)) return send(res, 404, { success: false, error: 'Not found' });
    let entered = false;
    try {
      const data = await body(req);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return send(res, 400, { success: false, error: 'Object required' });
      const { prompt, callId } = data;
      if (typeof callId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(callId)) return send(res, 400, { success: false, error: 'Valid callId required' });
      if (req.url === '/end-session') {
        if (busy) return send(res, 409, { success: false, error: 'Request still running; no cancellation implied' });
        sessions.delete('limited:'+callId);sessions.delete('approved:'+callId);
        return send(res, 200, { success: true });
      }
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) return send(res, 400, { success: false, error: 'Valid prompt required (max 8000 characters)' });
      if (busy) return send(res, 429, { success: false, error: 'One voice request at a time' });
      busy = true; entered = true;
      const started = Date.now();
      for (const [id, session] of sessions) if (started - session.used > ttl) sessions.delete(id);
      const sessionKey=(approved?'approved:':'limited:')+callId;
      let session = sessions.get(sessionKey);
      if (!session) {
        if (sessions.size >= 32) return send(res, 429, { success: false, error: 'Session limit reached' });
        session = { user: 'phone-' + randomUUID(), used: started };
        sessions.set(sessionKey, session);
      }
      session.used = started;
      // Device prompts and arbitrary agent/session overrides are deliberately ignored.
      const upstream = await fetchImpl(target, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: 'Bearer ' + gatewayToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openclaw/' + (approved?'main':agent), user: session.user, stream: false,
          messages: [{ role: 'user', content: (approved?'This is a phone conversation routed to the dashboard agent under the owner-configured trusted-PBX and pre-approved caller-list access policy. Caller ID is not proof of a person’s identity; do not claim an authenticated dashboard session or reuse its transcript. Apply your normal tool permissions, approval requirements and privacy safeguards. Answer the request conversationally; this is not FAQ-only. Keep speech concise.\n\n':'This is a phone conversation. Reply in plain conversational language, ideally under 40 words. Do not assume caller identity or authority.\n\n') + prompt }] }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!upstream.ok) return send(res, 502, { success: false, error: 'Gateway request failed', upstreamStatus: upstream.status });
      const result = await upstream.json();
      const response = result.choices?.[0]?.message?.content;
      if (typeof response !== 'string' || !response.trim()) return send(res, 502, { success: false, error: 'No speech response' });
      return send(res, 200, { success: true, response, sessionId: session.user, duration_ms: Date.now() - started });
    } catch (error) {
      const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
      console.warn(JSON.stringify({event:'phone-consult-failed',code:timedOut?'CONSULT_TIMEOUT':'CONSULT_UNAVAILABLE'}));
      return send(res, error.status || (timedOut ? 504 : 502), { success: false, code:timedOut?'CONSULT_TIMEOUT':'CONSULT_UNAVAILABLE', error: error.status ? error.message : 'OpenClaw consultation failed or timed out; no completion is confirmed. Do not automatically retry actions.' });
    } finally { if (entered) busy = false; }
  });
  server.requestTimeout = timeoutMs + 15000;
  server.headersTimeout = 10000;
  return server;
}
if (require.main === module) {
  const server = createBridge({
    gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || 'https://localhost:18789',
    gatewayToken: fileSecret('OPENCLAW_TOKEN_FILE'),
    bridgeToken: fileSecret('PHONE_BRIDGE_TOKEN_FILE'),
    agent: process.env.OPENCLAW_PHONE_AGENT || 'phone',
    fetchImpl: process.env.PHONE_GATEWAY_LOOPBACK === 'true' ? loopbackFetch : fetch
  });
  const host = process.env.PHONE_BRIDGE_HOST || '127.0.0.1';
  const port = Number(process.env.PHONE_BRIDGE_PORT || 3333);
  server.listen(port, host, () => console.log('OpenClaw phone bridge listening on ' + host + ':' + port));
}
module.exports = { createBridge, loopbackFetch };
