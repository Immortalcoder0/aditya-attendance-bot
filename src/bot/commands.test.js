import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAttendance } from '../portal/parse.js';
import { PROFILE_HTML } from '../portal/__fixtures__/profile.js';

const attendance = parseAttendance(PROFILE_HTML);
const log = { info() {}, warn() {}, error() {} };

function fakeStore(overrides = {}) {
  const user = {
    waJid: 'wa1',
    session: null,
    target: 0.75,
    dailySummary: true,
    lastSnapshot: null,
    lastAlertAt: {},
    ...overrides,
  };
  const calls = [];
  return {
    calls,
    user,
    async ensureUser() {
      return user;
    },
    getUser: () => user,
    async setSession(_jid, cookieHeader) {
      calls.push(['setSession', cookieHeader]);
      user.session = cookieHeader;
    },
    getSession: () => user.session,
    async clearSession() {
      calls.push(['clearSession']);
      user.session = null;
    },
    async forgetUser() {
      calls.push(['forgetUser']);
      return true;
    },
    async updateUser(_jid, patch) {
      calls.push(['updateUser', patch]);
      Object.assign(user, patch);
      return user;
    },
    async saveSnapshot(_jid, snap) {
      calls.push(['saveSnapshot']);
      user.lastSnapshot = snap;
    },
  };
}

class MockSessionExpiredError extends Error {}

/** Mocks session.js and client.js, then imports a fresh commands.js against them. */
async function loadCommandsWith(t, { sessionStatus, cookieHeader = 'cookie=x', fetchResult }) {
  t.mock.module('../portal/session.js', {
    namedExports: {
      ensureSession: async () => ({ status: sessionStatus, cookieHeader }),
      SessionResult: { OK: 'ok', NO_SESSION: 'no_session', ERROR: 'error' },
    },
  });
  t.mock.module('../portal/client.js', {
    namedExports: {
      // Echoes back whatever cookie it was actually called with by default —
      // matching render.js's real "unchanged unless rotated" behavior —
      // rather than a fixed value that ignores the argument.
      fetchAttendance: async (calledWithCookieHeader) => {
        if (fetchResult?.expireSession) throw new MockSessionExpiredError('dead');
        if (fetchResult?.error) throw fetchResult.error;
        return {
          attendance: fetchResult?.value ?? attendance,
          cookieHeader: fetchResult?.freshCookieHeader ?? calledWithCookieHeader,
        };
      },
      SessionExpiredError: MockSessionExpiredError,
    },
  });
  const { createCommandHandler } = await import(`./commands.js?t=${Math.random()}`);
  return createCommandHandler;
}

test('unknown text falls back to the menu', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  const reply = await handle('wa1', 'blah blah');
  assert.match(reply, /Attendance Bot/);
});

test('"1" with no session asks the user to link', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  const reply = await handle('wa1', '1');
  assert.match(reply, /Link your Campus Connect account/);
});

test('"1" with a live session returns live overall attendance', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'ok' });
  const store = fakeStore({ session: 'cookie=x' });
  const { handle } = createCommandHandler({ store, log });

  const reply = await handle('wa1', '1');
  assert.match(reply, /66\.67%/);
  assert.ok(store.calls.some((c) => c[0] === 'saveSnapshot'));
});

test('"1" persists a reissued cookie when fetchAttendance returns a rotated one', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, {
    sessionStatus: 'ok',
    cookieHeader: 'cookie=OLD',
    fetchResult: { freshCookieHeader: 'cookie=NEW' },
  });
  const store = fakeStore({ session: 'cookie=OLD' });
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '1');
  assert.ok(store.calls.some((c) => c[0] === 'setSession' && c[1] === 'cookie=NEW'));
});

test('"bunk" routes to the bunk calculator', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'ok' });
  const store = fakeStore({ session: 'cookie=x' });
  const { handle } = createCommandHandler({ store, log });

  const reply = await handle('wa1', 'bunk');
  assert.match(reply, /Bunk calculator/);
});

test('portal unreachable falls back to the last snapshot when one exists', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'error' });
  const store = fakeStore({ lastSnapshot: attendance });
  const { handle } = createCommandHandler({ store, log });

  const reply = await handle('wa1', '1');
  assert.match(reply, /Last known/);
  assert.match(reply, /66\.67/);
});

test('a live session that dies mid-fetch reports session expired', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, {
    sessionStatus: 'ok',
    fetchResult: { expireSession: true },
  });
  const store = fakeStore({ session: 'cookie=x' });
  const { handle } = createCommandHandler({ store, log });

  const reply = await handle('wa1', '1');
  assert.match(reply, /session expired/);
});

test('"session <cookie>" validates and stores a pasted session', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'ok' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  const reply = await handle('wa1', 'session ASP.NET_SessionId=abc; AuthToken=def');
  assert.ok(
    store.calls.some((c) => c[0] === 'setSession' && c[1] === 'ASP.NET_SessionId=abc; AuthToken=def')
  );
  assert.match(reply, /Session linked/);
});

test('"session <cookie>" rejects an invalid/expired cookie', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, {
    sessionStatus: 'ok',
    fetchResult: { expireSession: true },
  });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  const reply = await handle('wa1', 'session ASP.NET_SessionId=expired123');
  assert.match(reply, /invalid or already expired/);
  assert.ok(!store.calls.some((c) => c[0] === 'setSession'));
});

test('"session <garbage>" with nothing cookie-shaped asks to retry', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  const reply = await handle('wa1', 'session hey what does this button do');
  assert.match(reply, /couldn't find anything cookie-shaped/);
  assert.ok(!store.calls.some((c) => c[0] === 'setSession'));
});

test('"link" shows instructions without touching the store', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  const reply = await handle('wa1', 'link');
  assert.match(reply, /DevTools/);
  assert.equal(store.calls.length, 0);
});

test('"unlink" wipes stored data', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore({ session: 'cookie=x' });
  const { handle } = createCommandHandler({ store, log });

  const reply = await handle('wa1', 'unlink');
  assert.ok(store.calls.some((c) => c[0] === 'forgetUser'));
  assert.match(reply, /Done/);
});

test('"target 80" updates the stored target', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  const reply = await handle('wa1', 'target 80');
  assert.match(reply, /80%/);
  assert.equal(store.user.target, 0.8);
});

test('"target 150" is rejected as out of range', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  const reply = await handle('wa1', 'target 150');
  assert.match(reply, /between 1 and 100/);
  assert.equal(store.user.target, 0.75); // unchanged
});
