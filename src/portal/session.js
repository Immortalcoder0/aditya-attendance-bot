import { keepAlive } from './client.js';

/**
 * Keeps a student's Campus Connect session usable.
 *
 * There is deliberately no automated login here. A real-browser (Playwright)
 * auto-login was tried and consistently blocked by Cloudflare Turnstile even in
 * headed mode — evidence points to Turnstile flagging the DevTools Protocol
 * connection Playwright/Puppeteer/Selenium all use to control a browser,
 * independent of headless vs. headed. The only way past that is to mask the
 * automation artifacts it detects (e.g. stealth plugins), which is exactly the
 * anti-bot evasion this project won't do.
 *
 * So a session can only ever get in here the way Turnstile is designed to
 * accept: a real human logging in themselves, once, and handing the bot the
 * resulting session cookie. From there, this module's job is just to keep that
 * cookie alive for as long as possible with plain authenticated requests, which
 * never touch Turnstile at all — and to persist whatever refreshed cookie the
 * server hands back, since ASP.NET commonly reissues auth cookies on activity
 * and a stored copy that never gets updated goes stale regardless of how often
 * it's polled.
 */

export const SessionResult = Object.freeze({
  OK: 'ok',
  NO_SESSION: 'no_session',
  ERROR: 'error',
});

/**
 * @returns {Promise<{status: string, cookieHeader?: string}>}
 */
export async function ensureSession(store, waJid, log) {
  const existing = store.getSession(waJid);
  if (!existing) return { status: SessionResult.NO_SESSION };

  try {
    const { alive, cookieHeader } = await keepAlive(existing);
    if (!alive) {
      await store.clearSession(waJid);
      return { status: SessionResult.NO_SESSION };
    }
    if (cookieHeader !== existing) {
      log.info({ waJid }, 'session cookie refreshed by server, persisting update');
      await store.setSession(waJid, cookieHeader);
    }
    return { status: SessionResult.OK, cookieHeader };
  } catch (err) {
    log.warn({ err: err.message, waJid }, 'keepalive request failed');
    return { status: SessionResult.ERROR };
  }
}
