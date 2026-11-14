const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBridge } = require('./server.cjs');
const TOKEN = 'test-only-token-not-a-real-credential';
async function fixture(t, fetchImpl) {
  const server = createBridge({ gatewayUrl: 'http://127.0.0.1:18789', gatewayToken: 'test-gateway', bridgeToken: TOKEN, fetchImpl });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  const base = 'http://127.0.0.1:' + server.address().port;
  return async (route, data, auth = true) => fetch(base + route, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(auth ? { Authorization: 'Bearer ' + TOKEN } : {}), 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
}
const ok = () => Promise.resolve({ ok: true, json: async () => ({ choices: [{ message: { content: 'Hello from OpenClaw.' } }] }) });
test('health does not claim upstream connectivity', async t => {
  const request = await fixture(t, ok); const res = await request('/health');
  assert.equal(res.status, 200); assert.equal((await res.json()).upstreamVerified, false);
});
test('rejects requests without authentication', async t => {
  const request = await fixture(t, () => { throw Error('must not call upstream'); });
  assert.equal((await request('/ask', { callId: 'call1', prompt: 'hi' }, false)).status, 401);
});
test('validates body and call identifier', async t => {
  const request = await fixture(t, ok);
  for (const body of [null, [], {}, { callId: '../main', prompt: 'hi' }, { callId: 'call1', prompt: '' }]) {
    assert.equal((await request('/ask', body)).status, 400);
  }
});
test('rejects oversized input', async t => {
  const request = await fixture(t, ok);
  assert.equal((await request('/ask', { callId: 'c', prompt: 'x'.repeat(17000) })).status, 413);
});
test('routes fixed agent, preserves call isolation, ignores device instructions, ends local mapping', async t => {
  const bodies = [];
  const request = await fixture(t, async (url, options) => {
    assert.equal(url.pathname, '/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-gateway');
    bodies.push(JSON.parse(options.body)); return ok();
  });
  const ask = callId => request('/ask', { callId, prompt: 'hi', devicePrompt: 'MALICIOUS DEVICE INSTRUCTION', agent: 'main' });
  assert.equal((await (await ask('one')).json()).response, 'Hello from OpenClaw.');
  await ask('one'); await ask('two');
  assert.equal(bodies[0].model, 'openclaw/phone');
  assert.equal(bodies[0].user, bodies[1].user);
  assert.notEqual(bodies[0].user, bodies[2].user);
  assert.ok(!JSON.stringify(bodies[0]).includes('MALICIOUS'));
  assert.equal((await request('/end-session', { callId: 'one' })).status, 200);
  await ask('one'); assert.notEqual(bodies[0].user, bodies[3].user);
});
test('serializes requests without an unbounded queue', async t => {
  let release; let entered;
  const started = new Promise(r => { entered = r; });
  const request = await fixture(t, async () => { entered(); await new Promise(r => { release = r; }); return ok(); });
  const first = request('/ask', { callId: 'a', prompt: 'hi' }); await started;
  assert.equal((await request('/ask', { callId: 'b', prompt: 'hi' })).status, 429);
  assert.equal((await request('/end-session', { callId: 'a' })).status, 409);
  release(); assert.equal((await first).status, 200);
});
test('does not leak upstream errors or secrets', async t => {
  const request = await fixture(t, async () => { throw Error('SECRET'); });
  const res = await request('/ask', { callId: 'a', prompt: 'hi' });
  assert.equal(res.status, 502); assert.ok(!(await res.text()).includes('SECRET'));
});
test('rejects nonlocal unencrypted gateway transport', () => {
  assert.throws(() => createBridge({ gatewayUrl: 'http://example.com', gatewayToken: 'test', bridgeToken: TOKEN }));
});

test('patched upstream client authenticates query and hangup against the real bridge', async t => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-bridge-test-'));
  const tokenFile = path.join(dir, 'token'); fs.writeFileSync(tokenFile, TOKEN, { mode: 0o600 });
  const server = createBridge({ gatewayUrl: 'http://127.0.0.1:18789', gatewayToken: 'test', bridgeToken: TOKEN, fetchImpl: ok });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const oldUrl = process.env.CLAUDE_API_URL, oldFile = process.env.PHONE_BRIDGE_TOKEN_FILE;
  process.env.CLAUDE_API_URL = 'http://127.0.0.1:' + server.address().port;
  process.env.PHONE_BRIDGE_TOKEN_FILE = tokenFile;
  const clientPath = require.resolve('../voice-app/lib/claude-bridge.js'); delete require.cache[clientPath];
  t.after(async () => {
    delete require.cache[clientPath];
    if (oldUrl === undefined) delete process.env.CLAUDE_API_URL; else process.env.CLAUDE_API_URL = oldUrl;
    if (oldFile === undefined) delete process.env.PHONE_BRIDGE_TOKEN_FILE; else process.env.PHONE_BRIDGE_TOKEN_FILE = oldFile;
    server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true });
  });
  const client = require(clientPath);
  assert.equal(await client.query('hello', { callId: 'integration-call' }), 'Hello from OpenClaw.');
  assert.equal(await client.isAvailable(), true);
  await client.endSession('integration-call');
});
test('patched voice HTTP and audio WebSocket listeners bind loopback', async t => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-listener-test-'));
  const { createHttpServer } = require('../voice-app/lib/http-server.js');
  const { AudioForkServer } = require('../voice-app/lib/audio-fork.js');
  const httpServer = createHttpServer(dir, 0);
  await new Promise(r => httpServer.server.once('listening', r));
  t.after(() => new Promise(r => { httpServer.server.closeAllConnections(); httpServer.server.close(() => { fs.rmSync(dir, { recursive: true }); r(); }); }));
  assert.equal(httpServer.server.address().address, '127.0.0.1');
  const audio = new AudioForkServer({ port: 0 });
  assert.equal(audio.host, '127.0.0.1');
});
