'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const scratch = '/opt/data/cache/scratch';
const valid = { name: 'Ada', callback: '+1 555 0100', reason: 'Please call back', consent: true };
async function fixture(t) {
  await fs.mkdir(scratch, { recursive: true });
  const root = await fs.mkdtemp(path.join(scratch, 'message-store-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
function api() { return require('../lib/message-store'); }

test('rejects unsafe directory options instead of chmodding shared ancestors', () => {
  for (const dir of ['', ' ', '/', '/one/..', null, 42]) {
    assert.throws(() => api().createMessageStore({ dir }), { code: 'INVALID_STORE_OPTIONS' });
  }
});

test('snapshots validated fields before asynchronous work', async t => {
  const root = await fixture(t);
  const message = { ...valid };
  const pending = api().createMessageStore({ dir: path.join(root, 'inbox') }).save(message);
  message.name = 'x'.repeat(10000);
  message.consent = false;
  const result = await pending;
  const saved = JSON.parse(await fs.readFile(result.path));
  assert.equal(saved.name, valid.name);
  assert.equal(saved.consent, true);
});

test('fails closed when another process owns the directory write lock', async t => {
  const root = await fixture(t);
  const dir = path.join(root, 'inbox');
  await fs.mkdir(dir);
  await fs.mkdir(path.join(dir, '.write-lock'), { mode: 0o700 });
  await assert.rejects(api().createMessageStore({ dir, logger: { error() {} } }).save(valid), { code: 'MESSAGE_STORE_BUSY' });
  assert.deepEqual(await fs.readdir(dir), ['.write-lock']);
});

test('logs initialization failure privately and rejects with a sanitized error', async t => {
  const root = await fixture(t);
  const privatePath = path.join(root, 'PRIVATE-PATH-TOKEN');
  await fs.writeFile(privatePath, 'not a directory');
  const logs = [];
  const store = api().createMessageStore({ dir: privatePath, logger: { error(...args) { logs.push(args); } } });
  await assert.rejects(store.save(valid, { callId: 'SECRET-CALL' }), error => {
    assert.equal(error.code, 'MESSAGE_STORE_UNAVAILABLE');
    assert.equal(error.message, 'Message store unavailable');
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(logs.length, 1);
  const text = JSON.stringify(logs);
  assert.match(text, /initialize/);
  assert.match(text, /ENOTDIR/);
  for (const secret of [privatePath, 'PRIVATE-PATH-TOKEN', valid.name, valid.callback, valid.reason, 'SECRET-CALL']) assert.ok(!text.includes(secret));
});

test('getMessageStore returns a lazy default singleton without touching the default inbox', () => {
  const store = api().getMessageStore();
  assert.equal(api().getMessageStore(), store);
  assert.equal(typeof store.save, 'function');
});

test('enforces capacity across concurrent stores and existing files without deleting messages', async t => {
  const root = await fixture(t);
  const dir = path.join(root, 'inbox');
  const stores = [0, 1].map(() => api().createMessageStore({ dir, maxMessages: 3, logger: { error() {} } }));
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => stores[i % 2].save(valid)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 3);
  for (const result of results.filter(r => r.status === 'rejected')) assert.equal(result.reason.code, 'MESSAGE_STORE_FULL');
  assert.equal((await fs.readdir(dir)).length, 3);
  await assert.rejects(api().createMessageStore({ dir, maxMessages: 3, logger: { error() {} } }).save(valid), { code: 'MESSAGE_STORE_FULL' });
  for (const maxMessages of [0, -1, 1.5, NaN, Infinity, '3']) {
    assert.throws(() => api().createMessageStore({ dir, maxMessages }), { code: 'INVALID_STORE_OPTIONS' });
  }
});

test('publishes only complete messages and removes partial files on a write failure', async t => {
  const root = await fixture(t);
  const dir = path.join(root, 'inbox');
  const writeFile = fs.writeFile.bind(fs);
  t.mock.method(fs, 'writeFile', async (file, data, options) => {
    await writeFile(file, '{', options);
    throw Object.assign(new Error('simulated private failure'), { code: 'EIO' });
  });
  await assert.rejects(api().createMessageStore({ dir, logger: { error() {} } }).save(valid));
  assert.deepEqual(await fs.readdir(dir), []);
});

test('opens a private directory without following symlinks in any path component', async t => {
  const root = await fixture(t);
  const actual = path.join(root, 'actual');
  await fs.mkdir(actual, { mode: 0o755 });
  const link = path.join(root, 'link');
  await fs.symlink(actual, link);
  const logger = { error() {} };
  await assert.rejects(api().createMessageStore({ dir: link, logger }).save(valid));
  await assert.rejects(api().createMessageStore({ dir: path.join(link, 'child'), logger }).save(valid));
  assert.deepEqual(await fs.readdir(actual), []);
  const store = api().createMessageStore({ dir: actual });
  await store.save(valid);
  assert.equal((await fs.stat(actual)).mode & 0o777, 0o700);
  const moved = path.join(root, 'moved');
  await fs.rename(actual, moved);
  await fs.symlink(moved, actual);
  await assert.rejects(store.save(valid));
  assert.equal((await fs.readdir(moved)).length, 1);
});

test('rejects invalid consent, empty fields, oversized fields and unsafe metadata before disk writes', async t => {
  const root = await fixture(t);
  const dir = path.join(root, 'inbox');
  const store = api().createMessageStore({ dir });
  for (const consent of [false, undefined, 'true', 1]) {
    await assert.rejects(store.save({ ...valid, consent }), { code: 'INVALID_MESSAGE' });
  }
  for (const [field, limit] of [['name', 200], ['callback', 200], ['reason', 4000]]) {
    for (const value of ['', '  ', null, 42, 'x'.repeat(limit + 1)]) {
      await assert.rejects(store.save({ ...valid, [field]: value }), { code: 'INVALID_MESSAGE' });
    }
  }
  for (const message of [null, undefined, [], 'message']) {
    await assert.rejects(store.save(message), { code: 'INVALID_MESSAGE' });
  }
  await assert.rejects(store.save(valid, { callId: 'x'.repeat(257) }), { code: 'INVALID_MESSAGE' });
  await assert.rejects(store.save(valid, { callId: { secret: true } }), { code: 'INVALID_MESSAGE' });
  await assert.rejects(fs.stat(dir), { code: 'ENOENT' });
  const result = await store.save({ ...valid, name: 'x'.repeat(200), callback: 'x'.repeat(200), reason: 'x'.repeat(4000), extraSecret: 'do not persist' });
  assert.equal(JSON.parse(await fs.readFile(result.path)).extraSecret, undefined);
});

test('saves a unique private JSON message with server metadata', async t => {
  const root = await fixture(t);
  const dir = path.join(root, 'inbox');
  const store = api().createMessageStore({ dir });
  const result = await store.save(valid, { callId: 'call-123' });
  assert.match(result.id, /^[0-9a-f-]{36}$/);
  assert.equal(result.path, path.join(dir, result.id + '.json'));
  const saved = JSON.parse(await fs.readFile(result.path, 'utf8'));
  assert.deepEqual({ name: saved.name, callback: saved.callback, reason: saved.reason, consent: saved.consent }, valid);
  assert.equal(saved.id, result.id);
  assert.equal(saved.callId, 'call-123');
  assert.ok(Number.isFinite(Date.parse(saved.createdAt)));
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(result.path)).mode & 0o777, 0o600);
  const second = await store.save(valid);
  assert.notEqual(second.id, result.id);
  assert.deepEqual((await fs.readdir(dir)).sort(), [result.id + '.json', second.id + '.json'].sort());
});
