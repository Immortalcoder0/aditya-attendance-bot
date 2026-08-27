import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';

import { config } from '../config.js';
import { parseAttendance, SessionExpiredError, AttendanceUnavailableError } from './parse.js';

/**
 * Renders the attendance page through a real, independently-launched, windowed
 * Chrome instance attached to via CDP — deliberately not Playwright's own
 * browser launcher.
 *
 * StudentProfile.aspx loads attendance data via a WebMethod call
 * (ShowStudentProfileNew) that returned "UNAUTHORIZED" under every scripted
 * configuration tried: Playwright's bundled Chromium, real installed Chrome
 * via Playwright, with and without navigator.webdriver hidden, with a normal
 * desktop User-Agent, with navigator.plugins stubbed non-empty, and via an
 * independently-launched Chrome attached over CDP (matching how a browser
 * extension controls a tab) — all while headless. The one change that fixed
 * it was rendering in a real, windowed (non-headless) Chrome instance; hiding
 * navigator.webdriver alone made no difference, which rules out automation
 * detection as the cause. This points to a mundane rendering-path difference
 * (GPU/WebGL/focus-dependent behavior differs between headless and windowed
 * Chrome) rather than anything adversarial.
 *
 * On a display-less server this needs a virtual display (Xvfb on Linux, set
 * before this process starts) — Chrome just needs *some* display to render
 * into, real or virtual; nothing here cares which.
 */

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findChrome() {
  // An explicit CHROME_PATH is trusted as-is — if it's wrong, spawn() below
  // fails with a clear ENOENT rather than a pre-check here.
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'No Chrome install found on this machine. Set CHROME_PATH to your Chrome executable — ' +
        'a real Chrome install is required (see render.js for why headless/bundled Chromium is not enough).'
    );
  }
  return found;
}

const CDP_PORT = Number(process.env.CDP_PORT ?? 9333);
const CDP_READY_TIMEOUT_MS = Number(process.env.CDP_READY_TIMEOUT_MS ?? 15_000);
const NAV_TIMEOUT_MS = 25_000;
const TABLE_WAIT_TIMEOUT_MS = 15_000;

let chromeProcess = null;
let browserPromise = null;
let userDataDir = null;

async function waitForCdpReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function launchChrome() {
  userDataDir = mkdtempSync(join(tmpdir(), 'attendance-bot-chrome-'));
  const proc = spawn(
    findChrome(),
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=2000,2000', // off-screen on machines with a real display
      // Container-only concerns, unrelated to the headless-vs-windowed
      // finding above: Chrome refuses to start as root without --no-sandbox,
      // and Docker's default 64MB /dev/shm is too small for Chrome's shared
      // memory use without --disable-dev-shm-usage.
      '--no-sandbox',
      '--disable-dev-shm-usage',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  // If Chrome dies unexpectedly, drop the cached connection so the next
  // request relaunches instead of reusing a dead reference.
  proc.on('exit', () => {
    if (chromeProcess === proc) {
      chromeProcess = null;
      browserPromise = null;
    }
  });

  return proc;
}

async function getBrowser() {
  if (browserPromise) return browserPromise;

  browserPromise = (async () => {
    const proc = launchChrome();
    chromeProcess = proc;
    const ready = await waitForCdpReady(CDP_PORT, CDP_READY_TIMEOUT_MS);
    if (!ready) {
      // proc may have already exited (and nulled chromeProcess via its own
      // 'exit' handler) if it crashed rather than just being slow to start.
      proc.kill();
      throw new Error('Chrome did not become ready for CDP attachment in time');
    }
    return chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  })();

  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    browserPromise = null;
    await browser?.close().catch(() => {});
  }

  if (chromeProcess) {
    const proc = chromeProcess;
    chromeProcess = null;
    // Wait for the process to actually exit before touching its profile
    // directory — on Windows, files (SQLite dbs especially) can stay locked
    // for a moment after the kill signal is sent.
    await new Promise((resolve) => {
      proc.once('exit', resolve);
      proc.kill();
      setTimeout(resolve, 2000);
    });
  }

  if (userDataDir) {
    const dir = userDataDir;
    userDataDir = null;
    // Best-effort: an orphaned temp profile dir is harmless clutter, not
    // worth crashing shutdown over if a lock is still held.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // ignore
    }
  }
}

/**
 * Renders arbitrary self-contained HTML and returns a PNG screenshot.
 *
 * Reuses the same real-Chrome singleton as attendance rendering — this is
 * purely for chart images (see bot/chart.js), unrelated to the portal at all,
 * but there's no reason to launch a second Chrome instance for it.
 */
export async function screenshotHtml(html, { width = 900, height = 600 } = {}) {
  let context;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await page.screenshot({ type: 'png' });
  } finally {
    await context?.close().catch(() => {});
  }
}

function parseCookieHeader(cookieHeader, domain) {
  return cookieHeader
    .split(';')
    .map((pair) => {
      const idx = pair.indexOf('=');
      if (idx < 0) return null;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      return name ? { name, value, domain, path: '/' } : null;
    })
    .filter(Boolean);
}

/**
 * Fetch and parse live attendance by rendering the page in a real browser.
 *
 * ASP.NET commonly reissues auth cookies with a refreshed expiry on activity
 * (sliding expiration). A real browser context tracks that automatically, so
 * this reads the context's current cookie jar afterward and returns it
 * alongside the data — callers must persist it if it changed, or the stored
 * session silently drifts stale even while being actively used.
 *
 * @returns {Promise<{attendance: object, cookieHeader: string}>}
 */
export async function renderAttendance(cookieHeader) {
  let context;
  try {
    const browser = await getBrowser();
    context = await browser.newContext();

    const domain = new URL(config.portal.origin).hostname;
    await context.addCookies(parseCookieHeader(cookieHeader, domain));

    const page = await context.newPage();
    const pageUrl = `${config.portal.origin}${config.portal.profilePath}`;
    // domcontentloaded, not networkidle: the login/Turnstile page (reached
    // when the session is actually dead) keeps background widget traffic
    // going indefinitely, so networkidle never resolves there and stalls for
    // the full nav timeout. The explicit table-wait below is what actually
    // signals "the page's own JS finished loading data" on a live session.
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    // The table starts CSS-hidden (accordion panel collapsed) even once
    // populated, so wait for it to exist rather than to be visible. If the
    // session is actually dead, this just times out and parseAttendance
    // correctly detects the login page instead.
    await page
      .waitForSelector('table.reportTable', { state: 'attached', timeout: TABLE_WAIT_TIMEOUT_MS })
      .catch(() => {});

    const html = await page.content();
    const attendance = parseAttendance(html);

    const freshCookies = await context.cookies(pageUrl);
    const freshCookieHeader = freshCookies.map((c) => `${c.name}=${c.value}`).join('; ');

    return { attendance, cookieHeader: freshCookieHeader || cookieHeader };
  } catch (cause) {
    if (cause instanceof SessionExpiredError || cause instanceof AttendanceUnavailableError) throw cause;
    const err = new Error(`Rendering Campus Connect failed: ${cause.message}`);
    err.name = 'PortalUnreachableError';
    throw err;
  } finally {
    await context?.close().catch(() => {});
  }
}
