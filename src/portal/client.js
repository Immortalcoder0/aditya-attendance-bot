import { request } from 'undici';

import { config } from '../config.js';
import { isLoggedOut, SessionExpiredError } from './parse.js';
import { renderAttendance } from './render.js';

/**
 * Read-only HTTP client for Campus Connect.
 *
 * This client never logs in. It is handed a cookie header captured from a session
 * the student created themselves in a real browser, and only ever issues GETs.
 *
 * keepAlive stays plain HTTP — it just needs the server to see any
 * authenticated request to reset ASP.NET's sliding session expiry, and a plain
 * GET is enough for that. Actually fetching attendance data needs a real
 * browser (see render.js) since the data is populated by the page's own JS.
 *
 * ASP.NET commonly reissues auth cookies with a refreshed expiry on activity,
 * via Set-Cookie on the response. Every request here captures and merges that
 * in, so a caller that persists the returned cookieHeader keeps a genuinely
 * live session instead of one that quietly goes stale despite being polled.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function headers(cookieHeader) {
  return {
    cookie: cookieHeader,
    'user-agent': BROWSER_UA,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    referer: `${config.portal.origin}/aus/StudentMaster.aspx`,
  };
}

/**
 * The portal signals an expired session by 302-ing to the login page rather than
 * returning 401, so treat a redirect toward default.aspx as expiry.
 */
function redirectsToLogin(res) {
  if (res.statusCode < 300 || res.statusCode >= 400) return false;
  const location = res.headers.location ?? '';
  return /default\.aspx|login/i.test(String(location));
}

/** Merges Set-Cookie response headers into an existing cookie header string. */
function mergeSetCookie(cookieHeader, rawSetCookie) {
  const list = Array.isArray(rawSetCookie) ? rawSetCookie : rawSetCookie ? [rawSetCookie] : [];
  if (list.length === 0) return cookieHeader;

  const cookies = new Map();
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  for (const setCookie of list) {
    const firstPair = setCookie.split(';')[0];
    const idx = firstPair.indexOf('=');
    if (idx < 0) continue;
    cookies.set(firstPair.slice(0, idx).trim(), firstPair.slice(idx + 1).trim());
  }
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** @returns {Promise<{body: string, cookieHeader: string}>} */
async function get(path, cookieHeader) {
  let res;
  try {
    res = await request(`${config.portal.origin}${path}`, {
      method: 'GET',
      headers: headers(cookieHeader),
      maxRedirections: 0,
      headersTimeout: config.portal.requestTimeoutMs,
      bodyTimeout: config.portal.requestTimeoutMs,
    });
  } catch (cause) {
    const err = new Error(`Campus Connect request failed: ${cause.message}`);
    err.name = 'PortalUnreachableError';
    err.cause = cause;
    throw err;
  }

  if (redirectsToLogin(res)) {
    res.body.dump();
    throw new SessionExpiredError();
  }

  const body = await res.body.text();

  if (res.statusCode >= 400) {
    const err = new Error(`Campus Connect returned HTTP ${res.statusCode}`);
    err.name = 'PortalUnreachableError';
    throw err;
  }

  if (isLoggedOut(body)) throw new SessionExpiredError();

  return { body, cookieHeader: mergeSetCookie(cookieHeader, res.headers['set-cookie']) };
}

/** Fetch and parse live attendance. Throws SessionExpiredError if the cookie died. */
export const fetchAttendance = renderAttendance;

/**
 * Touch the portal purely to reset ASP.NET's sliding session expiry.
 * @returns {Promise<{alive: boolean, cookieHeader: string}>}
 */
export async function keepAlive(cookieHeader) {
  try {
    const result = await get(config.portal.keepAlivePath, cookieHeader);
    return { alive: true, cookieHeader: result.cookieHeader };
  } catch (err) {
    if (err instanceof SessionExpiredError) return { alive: false, cookieHeader };
    throw err;
  }
}

export { SessionExpiredError };
