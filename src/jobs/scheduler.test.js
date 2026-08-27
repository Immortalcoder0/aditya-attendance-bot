import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAttendance } from '../portal/parse.js';
import { PROFILE_HTML } from '../portal/__fixtures__/profile.js';

const attendance = parseAttendance(PROFILE_HTML);
const log = { info() {}, warn() {}, error() {} };

function fakeStore(user) {
  const calls = [];
  return {
    calls,
    async updateUser(_jid, patch) {
      calls.push(['updateUser', patch]);
      Object.assign(user, patch);
    },
    async saveSnapshot() {
      calls.push(['saveSnapshot']);
    },
    async setSession(_jid, cookieHeader) {
      calls.push(['setSession', cookieHeader]);
    },
  };
}

async function loadSchedulerWith(
  t,
  { sessionStatus = 'ok', cookieHeader = 'cookie=x', fetchValue, freshCookieHeader }
) {
  t.mock.module('../portal/session.js', {
    namedExports: {
      ensureSession: async () => ({ status: sessionStatus, cookieHeader }),
      SessionResult: { OK: 'ok', NO_SESSION: 'no_session', ERROR: 'error' },
    },
  });
  t.mock.module('../portal/client.js', {
    namedExports: {
      // Echoes back the cookie it was called with by default, matching
      // render.js's real "unchanged unless rotated" behavior.
      fetchAttendance: async (calledWithCookieHeader) => ({
        attendance: fetchValue ?? attendance,
        cookieHeader: freshCookieHeader ?? calledWithCookieHeader,
      }),
    },
  });
  return import(`./scheduler.js?t=${Math.random()}`);
}

test('checkLowAttendance sends one alert per below-target subject and records the timestamp', async () => {
  const { checkLowAttendance } = await import(`./scheduler.js?t=${Math.random()}`);
  const user = { waJid: 'wa1', target: 0.75, lastAlertAt: {} };
  const sent = [];
  const store = fakeStore(user);

  await checkLowAttendance(store, async (_jid, text) => sent.push(text), user, attendance);

  const below = attendance.subjects.filter((s) => s.attended / s.held < 0.75);
  assert.equal(sent.length, below.length);
  assert.ok(store.calls.some((c) => c[0] === 'updateUser'));
  for (const s of below) {
    assert.ok(user.lastAlertAt[s.code], `expected lastAlertAt entry for ${s.code}`);
  }
});

test('checkLowAttendance stays silent within the cooldown window', async () => {
  const { checkLowAttendance } = await import(`./scheduler.js?t=${Math.random()}`);
  const below = attendance.subjects.filter((s) => s.attended / s.held < 0.75);
  const recentAlerts = Object.fromEntries(below.map((s) => [s.code, new Date().toISOString()]));
  const user = { waJid: 'wa1', target: 0.75, lastAlertAt: recentAlerts };
  const sent = [];
  const store = fakeStore(user);

  await checkLowAttendance(store, async (_jid, text) => sent.push(text), user, attendance);

  assert.equal(sent.length, 0);
  assert.equal(store.calls.length, 0); // nothing changed, so no write
});

test('checkLowAttendance re-alerts once the cooldown has expired', async () => {
  const { checkLowAttendance } = await import(`./scheduler.js?t=${Math.random()}`);
  const staleTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24h ago
  const below = attendance.subjects.filter((s) => s.attended / s.held < 0.75);
  const user = {
    waJid: 'wa1',
    target: 0.75,
    lastAlertAt: Object.fromEntries(below.map((s) => [s.code, staleTime])),
  };
  const sent = [];
  const store = fakeStore(user);

  await checkLowAttendance(store, async (_jid, text) => sent.push(text), user, attendance);

  assert.equal(sent.length, below.length);
});

test('pollUser notifies a dead session once, then stays quiet on the same episode', async (t) => {
  const { pollUser } = await loadSchedulerWith(t, { sessionStatus: 'no_session' });
  const user = { waJid: 'wa1', target: 0.75, lastAlertAt: {} };
  const store = fakeStore(user);
  const sent = [];

  await pollUser(store, async (_jid, text) => sent.push(text), log, user);
  await pollUser(store, async (_jid, text) => sent.push(text), log, user);

  assert.equal(sent.length, 1);
  assert.match(sent[0], /session expired/);
});

test('pollUser stays quiet on a transient portal error', async (t) => {
  const { pollUser } = await loadSchedulerWith(t, { sessionStatus: 'error' });
  const user = { waJid: 'wa1', target: 0.75, lastAlertAt: {} };
  const store = fakeStore(user);
  const sent = [];

  await pollUser(store, async (_jid, text) => sent.push(text), log, user);

  assert.equal(sent.length, 0);
});

test('pollUser saves a snapshot and checks for low attendance on a healthy session', async (t) => {
  const { pollUser } = await loadSchedulerWith(t, { sessionStatus: 'ok', fetchValue: attendance });
  const user = { waJid: 'wa1', target: 0.75, lastAlertAt: {} };
  const store = fakeStore(user);
  const sent = [];

  await pollUser(store, async (_jid, text) => sent.push(text), log, user);

  assert.ok(store.calls.some((c) => c[0] === 'saveSnapshot'));
  const below = attendance.subjects.filter((s) => s.attended / s.held < 0.75);
  assert.equal(sent.length, below.length); // low-attendance alerts fired
});

test('pollUser persists a reissued cookie from fetchAttendance', async (t) => {
  const { pollUser } = await loadSchedulerWith(t, {
    sessionStatus: 'ok',
    cookieHeader: 'cookie=OLD',
    fetchValue: attendance,
    freshCookieHeader: 'cookie=NEW',
  });
  const user = { waJid: 'wa1', target: 0.75, lastAlertAt: {} };
  const store = fakeStore(user);

  await pollUser(store, async () => {}, log, user);

  assert.ok(store.calls.some((c) => c[0] === 'setSession' && c[1] === 'cookie=NEW'));
});
