'use strict';
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { constants } = require('node:fs');
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

// Linux /proc dirfd paths anchor every operation to an opened directory.
// Each user-supplied component is opened O_NOFOLLOW, including ancestors.
async function openPrivateDirectory(dir) {
  let handle = await fs.open('/', directoryFlags);
  try {
    for (const component of path.resolve(dir).split('/').filter(Boolean)) {
      const nextPath = `/proc/self/fd/${handle.fd}/${component}`;
      try { await fs.mkdir(nextPath, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      const next = await fs.open(nextPath, directoryFlags);
      await handle.close();
      handle = next;
    }
    await handle.chmod(0o700);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

const queues = new Map();
async function serialized(dir, work) {
  const previous = queues.get(dir) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  queues.set(dir, current);
  try { return await current; }
  finally { if (queues.get(dir) === current) queues.delete(dir); }
}

function createMessageStore({ dir = '/app/messages', maxMessages = 1000, logger = console } = {}) {
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 1 ||
      typeof dir !== 'string' || !dir.trim() || path.resolve(dir) === '/') {
    throw Object.assign(new Error('Invalid store options'), { code: 'INVALID_STORE_OPTIONS' });
  }
  dir = path.resolve(dir);
  return {
    async save(message, { callId } = {}) {
      message = message && { name: message.name, callback: message.callback, reason: message.reason, consent: message.consent };
      if (!message || message.consent !== true ||
          ![['name', 200], ['callback', 200], ['reason', 4000]].every(([key, limit]) =>
            typeof message[key] === 'string' && message[key].trim().length > 0 && message[key].length <= limit) ||
          (callId !== undefined && (typeof callId !== 'string' || !callId.trim() || callId.length > 256))) {
        throw Object.assign(new Error('Invalid message'), { code: 'INVALID_MESSAGE' });
      }
      let phase = 'initialize';
      try {
        return await serialized(dir, async () => {
      const directory = await openPrivateDirectory(dir);
      phase = 'save';
      const lock = `/proc/self/fd/${directory.fd}/.write-lock`;
      let locked = false;
      try {
        try { await fs.mkdir(lock, { mode: 0o700 }); locked = true; }
        catch (error) {
          if (error.code === 'EEXIST') throw Object.assign(new Error('Message store busy'), { code: 'MESSAGE_STORE_BUSY' });
          throw error;
        }
        const entries = await fs.readdir(`/proc/self/fd/${directory.fd}`);
        if (entries.filter(entry => entry.endsWith('.json')).length >= maxMessages) {
          throw Object.assign(new Error('Message store full'), { code: 'MESSAGE_STORE_FULL' });
        }
        const id = randomUUID();
        const target = path.join(dir, id + '.json');
        const base = `/proc/self/fd/${directory.fd}`;
        const temporary = `${base}/.${id}.tmp`;
        try {
          await fs.writeFile(temporary, JSON.stringify({ name: message.name, callback: message.callback, reason: message.reason, consent: true, id, callId, createdAt: new Date().toISOString() }) + '\n', { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode: 0o600 });
          const file = await fs.open(temporary, constants.O_RDONLY | constants.O_NOFOLLOW);
          try { await file.sync(); } finally { await file.close(); }
          // link is atomic and, unlike rename, never replaces an existing entry.
          await fs.link(temporary, `${base}/${id}.json`);
          await fs.unlink(temporary);
          await directory.sync();
          return { id, path: target };
        } finally {
          await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
      } finally {
        try { if (locked) await fs.rmdir(lock); }
        finally { await directory.close(); }
      }
      });
      } catch (error) {
        if (error.code === 'MESSAGE_STORE_FULL' || error.code === 'MESSAGE_STORE_BUSY') throw error;
        // Never log Error objects: their message/path/stack may contain secrets.
        try { logger.error('message-store failure', { phase, code: /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : 'UNKNOWN' }); }
        catch (_) { /* A failing logger must not leak the original error. */ }
        throw Object.assign(new Error('Message store unavailable'), { code: 'MESSAGE_STORE_UNAVAILABLE' });
      }
    }
  };
}
let singleton;
function getMessageStore() {
  if (!singleton) singleton = createMessageStore();
  return singleton;
}
module.exports = { createMessageStore, getMessageStore };
