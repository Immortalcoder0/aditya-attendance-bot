import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAttendance } from '../portal/parse.js';
import { PROFILE_HTML } from '../portal/__fixtures__/profile.js';

const attendance = parseAttendance(PROFILE_HTML);
const log = { info() {}, warn() {}, error() {} };

/** A handler reply may be a single string or an array of separate messages. */
const asText = (reply) => [].concat(reply ?? []).join('\n\n');

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

/** Mocks session.js, client.js and chart.js, then imports a fresh commands.js. */
async function loadCommandsWith(t, { sessionStatus, cookieHeader = 'cookie=x', fetchResult, chartError }) {
  t.mock.module('../portal/session.js', {
    namedExports: {
      ensureSession: async () => ({ status: sessionStatus, cookieHeader }),
      SessionResult: { OK: 'ok', NO_SESSION: 'no_session', ERROR: 'error' },
    },
  });
  t.mock.module('../portal/client.js', {
    namedExports: {
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
  t.mock.module('./chart.js', {
    namedExports: {
      renderAttendanceChart: async () => {
        if (chartError) throw chartError;
        return Buffer.from('fake-png-bytes');
      },
    },
  });
  const { createCommandHandler } = await import(`./commands.js?t=${Math.random()}`);
  return createCommandHandler;
}

test('idle: anything other than /start is silently ignored', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  assert.equal(await handle('wa1', 'hi'), null);
  assert.equal(await handle('wa1', '1'), null);
  assert.equal(await handle('wa1', 'menu'), null);
});

test('/start shows the main menu', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  const reply = await handle('wa1', '/start');
  assert.match(reply, /Attendance Bot/);
  assert.match(reply, /\*1\*/);
});

test('/start is case-insensitive', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  assert.match(await handle('wa1', '/START'), /Attendance Bot/);
});

test('main menu: "1" with no session redirects into the link flow', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  const reply = await handle('wa1', '1');
  assert.match(asText(reply), /Link your Campus Connect account/);

  // Now in the link flow: a cookie-shaped paste should be processed, not ignored.
  const linkReply = await handle('wa1', 'ASP.NET_SessionId=abc123');
  assert.match(asText(linkReply), /Session linked/);
});

test('main menu: "1" with a live session shows live overall attendance as its own message, then the menu separately', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'ok' });
  const store = fakeStore({ session: 'cookie=x' });
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  const reply = await handle('wa1', '1');
  assert.ok(Array.isArray(reply));
  assert.equal(reply.length, 2);
  assert.match(reply[0], /66\.67%/);
  assert.match(reply[1], /Attendance Bot/); // menu re-shown as a separate message
  assert.ok(store.calls.some((c) => c[0] === 'saveSnapshot'));
});

test('main menu: "2" sends the attendance chart as an image, then the menu', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'ok' });
  const store = fakeStore({ session: 'cookie=x' });
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  const reply = await handle('wa1', '2');
  assert.ok(Array.isArray(reply));
  assert.equal(reply.length, 2);
  assert.ok(Buffer.isBuffer(reply[0].image));
  assert.match(reply[0].caption, /Subject-wise attendance/);
  assert.match(reply[1], /Attendance Bot/);
});

test('main menu: "2" falls back to the text breakdown if chart rendering fails', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, {
    sessionStatus: 'ok',
    chartError: new Error('chrome crashed'),
  });
  const store = fakeStore({ session: 'cookie=x' });
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  const reply = await handle('wa1', '2');
  assert.ok(Array.isArray(reply));
  assert.match(reply[0], /Subject-wise attendance/);
  assert.doesNotMatch(reply[0], /\[object/); // definitely text, not a stray object
  assert.match(reply[1], /Attendance Bot/);
});

test('main menu: "3" shows the bunk calculator', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'ok' });
  const store = fakeStore({ session: 'cookie=x' });
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  const reply = await handle('wa1', '3');
  assert.match(asText(reply), /Bunk calculator/);
});

test('main menu: an unrecognized reply is silently ignored, not an error message', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'ok' });
  const store = fakeStore({ session: 'cookie=x' });
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  assert.equal(await handle('wa1', 'banana'), null);
});

test('main menu: "1" persists a reissued cookie', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, {
    sessionStatus: 'ok',
    cookieHeader: 'cookie=OLD',
    fetchResult: { freshCookieHeader: 'cookie=NEW' },
  });
  const store = fakeStore({ session: 'cookie=OLD' });
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  await handle('wa1', '1');
  assert.ok(store.calls.some((c) => c[0] === 'setSession' && c[1] === 'cookie=NEW'));
});

test('main menu: a session that dies mid-fetch reports session expired', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, {
    sessionStatus: 'ok',
    fetchResult: { expireSession: true },
  });
  const store = fakeStore({ session: 'cookie=x' });
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  const reply = await handle('wa1', '1');
  assert.match(reply, /session expired/);
});

test('main menu → settings → back to menu', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'ok' });
  const store = fakeStore({ session: 'cookie=x' });
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  const settings = await handle('wa1', '5');
  assert.match(settings, /Settings/);

  const back = await handle('wa1', '5');
  assert.match(back, /Attendance Bot/);
});

test('settings: change target end to end', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  await handle('wa1', '5'); // settings
  const prompt = await handle('wa1', '1'); // change target
  assert.match(prompt, /number/i);

  const result = await handle('wa1', '80');
  assert.match(asText(result), /80%/);
  assert.equal(store.user.target, 0.8);
});

test('settings: invalid target input re-prompts instead of crashing', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  await handle('wa1', '5');
  await handle('wa1', '1');
  const reply = await handle('wa1', '150');
  assert.match(reply, /\/start/);
  assert.equal(store.user.target, 0.75); // unchanged
});

test('settings: toggle daily summary', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  await handle('wa1', '5');
  const reply = await handle('wa1', '2');
  assert.equal(store.user.dailySummary, false);
  assert.match(reply, /off/);
});

test('settings: link flow via menu', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'ok' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  await handle('wa1', '5');
  const instructions = await handle('wa1', '3');
  assert.match(instructions, /DevTools/);

  const linked = await handle('wa1', 'ASP.NET_SessionId=abc123; AuthToken=def456');
  assert.match(asText(linked), /Session linked/);
  assert.ok(
    store.calls.some((c) => c[0] === 'setSession' && c[1] === 'ASP.NET_SessionId=abc123; AuthToken=def456')
  );
});

test('settings: invalid paste during link stays in the link flow for a retry', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'ok' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  await handle('wa1', '5');
  await handle('wa1', '3');
  const badReply = await handle('wa1', 'garbage, not a cookie');
  assert.match(badReply, /couldn't find anything cookie-shaped/);

  // Still in the link flow — a real paste right after should still work.
  const goodReply = await handle('wa1', 'ASP.NET_SessionId=abc123');
  assert.match(asText(goodReply), /Session linked/);
});

test('settings: unlink requires confirmation', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore({ session: 'cookie=x' });
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  await handle('wa1', '5');
  const confirmPrompt = await handle('wa1', '4');
  assert.match(confirmPrompt, /Delete everything/);
  assert.equal(store.calls.some((c) => c[0] === 'forgetUser'), false); // not deleted yet

  const result = await handle('wa1', '1');
  assert.match(result, /Done/);
  assert.ok(store.calls.some((c) => c[0] === 'forgetUser'));
});

test('settings: unlink cancel returns to settings without deleting', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore({ session: 'cookie=x' });
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  await handle('wa1', '5');
  await handle('wa1', '4');
  const result = await handle('wa1', '2');
  assert.match(result, /Settings/);
  assert.equal(store.calls.some((c) => c[0] === 'forgetUser'), false);
});

test('/start mid-flow resets back to the main menu, abandoning any in-progress prompt', async (t) => {
  const createCommandHandler = await loadCommandsWith(t, { sessionStatus: 'no_session' });
  const store = fakeStore();
  const { handle } = createCommandHandler({ store, log });

  await handle('wa1', '/start');
  await handle('wa1', '5');
  await handle('wa1', '1'); // now awaiting a target number

  const reply = await handle('wa1', '/start');
  assert.match(reply, /Attendance Bot/);

  // The abandoned target prompt's input ("80") is no longer being awaited —
  // it's back in main-menu context, where "80" isn't a valid option.
  assert.equal(await handle('wa1', '80'), null);
});
