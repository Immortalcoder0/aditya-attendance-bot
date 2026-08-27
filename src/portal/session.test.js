import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * ensureSession's job is now small on purpose: reuse a session if keepAlive
 * confirms it's alive, otherwise report NO_SESSION so the bot asks the user to
 * relink. There is no automated login path — see session.js for why (Cloudflare
 * Turnstile consistently blocked Playwright-driven Chromium, headless and
 * headed, in real testing against the live site).
 *
 * It also persists a reissued cookie when the server sends one back — ASP.NET
 * commonly rotates auth cookies on activity (sliding expiration), and without
 * this the stored session silently goes stale despite being actively polled.
 */

function fakeStore({ session = null } = {}) {
  const calls = [];
  return {
    calls,
    getSession: () => session,
    async clearSession(waJid) {
      calls.push(['clearSession', waJid]);
    },
    async setSession(waJid, cookieHeader) {
      calls.push(['setSession', waJid, cookieHeader]);
    },
  };
}

const log = { info() {}, warn() {}, error() {} };

async function loadSessionWith(t, { keepAliveResult }) {
  t.mock.module('./client.js', {
    namedExports: {
      keepAlive:
        typeof keepAliveResult === 'function' ? keepAliveResult : async () => keepAliveResult,
    },
  });
  return import(`./session.js?t=${Math.random()}`);
}

test('reuses an existing session when keepAlive confirms it is alive, unchanged cookie', async (t) => {
  const { ensureSession, SessionResult } = await loadSessionWith(t, {
    keepAliveResult: { alive: true, cookieHeader: 'cookie=abc' },
  });
  const store = fakeStore({ session: 'cookie=abc' });

  const result = await ensureSession(store, 'wa1', log);
  assert.equal(result.status, SessionResult.OK);
  assert.equal(result.cookieHeader, 'cookie=abc');
  assert.equal(store.calls.length, 0); // no write, nothing changed
});

test('persists a reissued cookie when the server rotates it', async (t) => {
  const { ensureSession, SessionResult } = await loadSessionWith(t, {
    keepAliveResult: { alive: true, cookieHeader: 'cookie=NEW' },
  });
  const store = fakeStore({ session: 'cookie=OLD' });

  const result = await ensureSession(store, 'wa1', log);
  assert.equal(result.status, SessionResult.OK);
  assert.equal(result.cookieHeader, 'cookie=NEW');
  assert.deepEqual(store.calls, [['setSession', 'wa1', 'cookie=NEW']]);
});

test('no session on file: reports NO_SESSION without calling keepAlive', async (t) => {
  const { ensureSession, SessionResult } = await loadSessionWith(t, {
    keepAliveResult: () => {
      throw new Error('should not be called');
    },
  });
  const store = fakeStore({ session: null });

  const result = await ensureSession(store, 'wa1', log);
  assert.equal(result.status, SessionResult.NO_SESSION);
});

test('dead session: clears it and reports NO_SESSION', async (t) => {
  const { ensureSession, SessionResult } = await loadSessionWith(t, {
    keepAliveResult: { alive: false, cookieHeader: 'cookie=stale' },
  });
  const store = fakeStore({ session: 'cookie=stale' });

  const result = await ensureSession(store, 'wa1', log);
  assert.equal(result.status, SessionResult.NO_SESSION);
  assert.deepEqual(store.calls, [['clearSession', 'wa1']]);
});

test('keepAlive throwing (portal unreachable): reports ERROR, keeps the session', async (t) => {
  const { ensureSession, SessionResult } = await loadSessionWith(t, {
    keepAliveResult: async () => {
      throw new Error('network down');
    },
  });
  const store = fakeStore({ session: 'cookie=abc' });

  const result = await ensureSession(store, 'wa1', log);
  assert.equal(result.status, SessionResult.ERROR);
  assert.equal(store.calls.length, 0); // not cleared — might just be transient
});
