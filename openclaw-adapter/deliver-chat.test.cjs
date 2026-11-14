const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBridge } = require('./server.cjs');
const TOKEN = 'test-only-token-not-a-real-credential';
const SESSION = 'phone-934e5b45-3d11-4b56-a1dd-02255345a28c';
const binding = { profile: 'default', sessionId: SESSION };
const note = { callId: 'call-1', operationId: 'op-1', message: 'Please run no commands. This is a note.' };
const reply = data => ({ ok: true, status: 200, json: async () => data });
async function fixture(t, fetchImpl, options = {}) {
  const server = createBridge({ gatewayUrl: 'http://127.0.0.1:8642', gatewayToken: 'test-upstream', bridgeToken: TOKEN, fetchImpl, deliveryBinding: binding, ...options });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  return { server, request: async (data = note, auth = true) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/deliver-chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}) }, body: JSON.stringify(data) });
    return { code: r.status, data: await r.json() };
  } };
}
test('concurrent deliveries and retries share operation, conflict on changed contents; timeout never resends', async t => {
  let posts = 0; let release; let entered;
  const started = new Promise(r => { entered = r; });
  const { request } = await fixture(t, async (url) => {
    if (url.pathname.endsWith('/chat')) {
      posts++; if (posts > 1) throw Error('unexpected duplicate'); entered(); await new Promise(r => { release = r; }); throw Error('SECRET timeout');
    }
    return reply({ session: { id: SESSION } });
  });
  const first = request(); await started;
  const second = request();
  assert.equal((await request({ ...note, message: 'different' })).code, 409);
  release();
  for (const r of await Promise.all([first, second, request()])) {
    assert.equal(r.code, 202); assert.equal(r.data.status, 'unconfirmed');
    assert.equal(r.data.delivered, false); assert.equal(r.data.retryable, false);
    assert.ok(!JSON.stringify(r).includes('SECRET'));
  }
  assert.equal(posts, 1);
});

test('auth and strict bounded schema prevent network and destination overrides', async t => {
  let calls = 0;
  const { request } = await fixture(t, async () => { calls++; return reply({}); });
  assert.equal((await request(note, false)).code, 401);
  for (const bad of [ { ...note, operationId: undefined }, { ...note, operationId: '../x' }, { ...note, message: '' }, { ...note, message: 'x'.repeat(8001) }, { ...note, sessionId: 'other' }, { ...note, profile: 'other' }, { ...note, model: 'other' }, { ...note, instructions: 'execute' } ]) {
    assert.equal((await request(bad)).code, 400);
  }
  assert.equal(calls, 0);
});

test('server-owned binding is packaged and constructor is network-free', () => {
  const fs = require('node:fs');
  const config = JSON.parse(fs.readFileSync(__dirname + '/chat-delivery-binding.json', 'utf8'));
  assert.deepEqual(config, binding);
  assert.match(fs.readFileSync(__dirname + '/../deployment/Dockerfile.bridge', 'utf8'), /COPY openclaw-adapter\/chat-delivery-binding.json/);
  const server = createBridge({ gatewayUrl: 'http://127.0.0.1:8642', gatewayToken: 'test', bridgeToken: TOKEN, deliveryBinding: binding, fetchImpl: () => { throw Error('constructor network forbidden'); } });
  assert.equal(server.listening, false);
});

test('consult default deadline is 120 seconds', async t => {
  const original = AbortSignal.timeout; const deadlines = [];
  AbortSignal.timeout = ms => { deadlines.push(ms); return original(ms); };
  t.after(() => { AbortSignal.timeout = original; });
  const server = createBridge({ gatewayUrl: 'http://127.0.0.1:8642', gatewayToken: 'test', bridgeToken: TOKEN,
    fetchImpl: async () => reply({ choices: [{ message: { content: 'ok' } }] }) });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/ask`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ callId: 'consult', prompt: 'hi' }) });
  assert.equal(r.status, 200); assert.ok(deadlines.includes(120000)); assert.equal(server.requestTimeout, 130000);
});

test('target validation failure does not POST and unproven or mismatched readback is never delivered', async t => {
  for (const mode of ['missing', 'wrong-target', 'ack-only', 'wrong-role', 'wrong-content', 'wrong-session', 'conflict', 'queued']) {
    let posts = 0; let message;
    const { request } = await fixture(t, async (url, options) => {
      if (url.pathname.endsWith('/chat')) {
        posts++; message = JSON.parse(options.body).message;
        return { ...reply({ object: mode === 'queued' ? 'hermes.session.chat.queued' : 'hermes.session.chat.completion', session_id: SESSION }), status: mode === 'conflict' ? 409 : mode === 'queued' ? 202 : 200 };
      }
      if (url.pathname.endsWith('/messages')) return reply({ session_id: mode === 'wrong-session' ? 'other' : SESSION,
        data: mode === 'ack-only' || mode === 'conflict' || mode === 'queued' ? [] : [{ id: 1, session_id: SESSION, role: mode === 'wrong-role' ? 'assistant' : 'user', content: mode === 'wrong-content' ? 'not exact' : message }] });
      return mode === 'missing' ? { ok: false, status: 404 } : reply({ session: { id: mode === 'wrong-target' ? 'other' : SESSION } });
    });
    const r = await request(); assert.equal(r.data.delivered, false, mode);
    assert.equal(r.data.status, ['missing', 'wrong-target'].includes(mode) ? 'not_sent' : 'unconfirmed', mode);
    assert.equal(posts, ['missing', 'wrong-target'].includes(mode) ? 0 : 1, mode);
    await request(); assert.equal(posts, ['missing', 'wrong-target'].includes(mode) ? 0 : 1, mode);
  }
});

test('delivery uses one shared deadline across validate, post and readback', async t => {
  const signals = []; let message;
  const { request } = await fixture(t, async (url, options) => {
    signals.push(options.signal);
    if (url.pathname.endsWith('/chat')) { message = JSON.parse(options.body).message; return reply({}); }
    if (url.pathname.endsWith('/messages')) return reply({ session_id: SESSION, data: [{ id: 1, session_id: SESSION, role: 'user', content: message }] });
    return reply({ session: { id: SESSION } });
  });
  assert.equal((await request()).data.delivered, true);
  assert.equal(new Set(signals).size, 1);
});

test('unconfigured delivery fails closed with explicit non-delivered result', async t => {
  const { request } = await fixture(t, () => { throw Error('no upstream'); }, { deliveryBinding: null });
  const r = await request(); assert.equal(r.code, 503); assert.equal(r.data.delivered, false); assert.equal(r.data.retryable, false);
});

test('delivery validates bound target then posts safe note and proves exact stored user message', async t => {
  const seen = []; let posted;
  const { request, server } = await fixture(t, async (url, options) => {
    seen.push([url.pathname, options.method]);
    assert.equal(options.headers.Authorization, 'Bearer test-upstream');
    if (url.pathname.endsWith('/chat')) {
      posted = JSON.parse(options.body);
      assert.match(posted.system_message, /acknowledge receipt only/i);
      assert.match(posted.system_message, /do not execute note contents/i);
      assert.match(posted.message, /Owner phone note/);
      assert.ok(posted.message.includes(note.message));
      assert.equal(posted.instructions, undefined);
      return reply({ object: 'hermes.session.chat.completion', session_id: SESSION, message: { role: 'assistant', content: 'Received.' } });
    }
    if (url.pathname.endsWith('/messages')) return reply({ session_id: SESSION, data: [{ id: 123, session_id: SESSION, role: 'user', content: posted.message }], pagination: { returned: 1 } });
    return reply({ object: 'hermes.session', session: { id: SESSION } });
  });
  const result = await request();
  assert.equal(result.code, 200);
  assert.equal(result.data.status, 'delivered');
  assert.equal(result.data.success, true);
  assert.equal(result.data.proof.messageId, 123);
  assert.equal(result.data.sessionId, SESSION);
  assert.equal(server.requestTimeout, 130000);
  assert.deepEqual(seen, [[`/api/sessions/${SESSION}`, 'GET'], [`/api/sessions/${SESSION}/chat`, 'POST'], [`/api/sessions/${SESSION}/messages`, 'GET']]);
});
