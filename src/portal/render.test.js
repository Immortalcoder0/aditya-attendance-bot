import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { PROFILE_HTML, LOGIN_HTML } from './__fixtures__/profile.js';
import { SessionExpiredError } from './parse.js';

/**
 * Exercises renderAttendance's control flow (CDP-ready polling, cookie
 * parsing, error classification) against mocked node:child_process/playwright
 * /fetch, so the logic is verified without spawning a real Chrome process.
 * node:fs is deliberately left unmocked — mocking it process-wide breaks
 * dotenv's own file reading for config.js, which every test file depends on.
 * CHROME_PATH is set directly instead, which findChrome() trusts without
 * touching fs at all.
 *
 * The real end-to-end mechanism — spawn real Chrome, attach over CDP, render
 * — was verified manually against the live site during development (see
 * render.js's header comment for why this specific approach is the one that
 * works).
 */

const FAKE_CHROME_PATH = 'C:/fake/chrome.exe';

function fakePage({ html }) {
  return {
    async goto() {},
    async waitForSelector() {
      if (!/reportTable/.test(html)) throw new Error('selector timeout');
    },
    async content() {
      return html;
    },
  };
}

function fakeCdpBrowser({ html, cookiesAdded = [], freshCookies }) {
  let added = [];
  return {
    async newContext() {
      return {
        async addCookies(cookies) {
          added = cookies;
          cookiesAdded.push(...cookies);
        },
        async newPage() {
          return fakePage({ html });
        },
        // Defaults to echoing back whatever was added (no server-side
        // rotation); tests can override to simulate a reissued cookie.
        async cookies() {
          return freshCookies ?? added.map(({ name, value }) => ({ name, value }));
        },
        async close() {},
      };
    },
    async close() {},
  };
}

/** Registers mocks and returns a fresh render.js module. */
async function loadRenderWith(t, { html, cdpReady = true, chromePath = FAKE_CHROME_PATH, freshCookies }) {
  if (chromePath) process.env.CHROME_PATH = chromePath;
  else delete process.env.CHROME_PATH;
  process.env.CDP_READY_TIMEOUT_MS = '200'; // keep the not-ready test fast

  t.mock.module('node:child_process', {
    namedExports: {
      spawn: () => {
        const proc = new EventEmitter();
        proc.kill = () => {};
        return proc;
      },
    },
  });

  t.mock.method(globalThis, 'fetch', async () => ({ ok: cdpReady }));

  const cookiesAdded = [];
  t.mock.module('playwright', {
    namedExports: {
      chromium: {
        async connectOverCDP() {
          return fakeCdpBrowser({ html, cookiesAdded, freshCookies });
        },
      },
    },
  });

  const mod = await import(`./render.js?t=${Math.random()}`);
  return { ...mod, cookiesAdded };
}

test('renders and parses attendance through the mocked CDP browser', async (t) => {
  const { renderAttendance } = await loadRenderWith(t, { html: PROFILE_HTML });
  const { attendance } = await renderAttendance('ASP.NET_SessionId=abc123');
  assert.equal(attendance.subjects.length, 8);
  assert.equal(attendance.total.percent, 66.67);
});

test('returns the cookie header unchanged when the server did not reissue it', async (t) => {
  const { renderAttendance } = await loadRenderWith(t, { html: PROFILE_HTML });
  const { cookieHeader } = await renderAttendance('ASP.NET_SessionId=abc123; AuthToken=def456');
  assert.equal(cookieHeader, 'ASP.NET_SessionId=abc123; AuthToken=def456');
});

test('returns the reissued cookie when the server rotated it (sliding expiration)', async (t) => {
  const { renderAttendance } = await loadRenderWith(t, {
    html: PROFILE_HTML,
    freshCookies: [
      { name: 'ASP.NET_SessionId', value: 'abc123' },
      { name: 'AuthToken', value: 'ROTATED-VALUE' },
    ],
  });
  const { cookieHeader } = await renderAttendance('ASP.NET_SessionId=abc123; AuthToken=def456');
  assert.equal(cookieHeader, 'ASP.NET_SessionId=abc123; AuthToken=ROTATED-VALUE');
});

test('parses the cookie header into individual cookie objects', async (t) => {
  const { renderAttendance, cookiesAdded } = await loadRenderWith(t, { html: PROFILE_HTML });
  await renderAttendance('ASP.NET_SessionId=abc123; AuthToken=def456');
  assert.deepEqual(cookiesAdded, [
    { name: 'ASP.NET_SessionId', value: 'abc123', domain: 'info.aec.edu.in', path: '/' },
    { name: 'AuthToken', value: 'def456', domain: 'info.aec.edu.in', path: '/' },
  ]);
});

test('throws SessionExpiredError when the rendered page is the login page', async (t) => {
  const { renderAttendance } = await loadRenderWith(t, { html: LOGIN_HTML });
  await assert.rejects(() => renderAttendance('ASP.NET_SessionId=dead'), SessionExpiredError);
});

test('wraps a CDP-ready timeout as PortalUnreachableError', async (t) => {
  const { renderAttendance } = await loadRenderWith(t, { html: PROFILE_HTML, cdpReady: false });
  await assert.rejects(() => renderAttendance('ASP.NET_SessionId=abc123'), (err) => {
    assert.equal(err.name, 'PortalUnreachableError');
    assert.match(err.message, /did not become ready/);
    return true;
  });
});

test('ignores a cookie header fragment with no "=" rather than crashing', async (t) => {
  const { renderAttendance, cookiesAdded } = await loadRenderWith(t, { html: PROFILE_HTML });
  await renderAttendance('ASP.NET_SessionId=abc123; garbage; AuthToken=def456');
  // (rendering also returns {attendance, cookieHeader}; this test only cares
  // about what got added to the browser context)
  assert.deepEqual(
    cookiesAdded.map((c) => c.name),
    ['ASP.NET_SessionId', 'AuthToken']
  );
});
