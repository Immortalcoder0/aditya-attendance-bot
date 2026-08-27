/**
 * Turns whatever someone pastes from DevTools into a usable Cookie header.
 *
 * The bar we can realistically get people over is "open DevTools once and copy
 * something roughly right" — not "copy exactly this one substring with zero
 * mistakes." So this accepts, in order of how it's detected:
 *
 *  1. A full Request Headers block (Network tab) — pulls out just the `cookie:`
 *     line even if `accept:`, `user-agent:`, etc. got copied along with it.
 *  2. A DevTools Application → Cookies table paste (tab-separated Name/Value
 *     rows, one row per cookie, an optional header row).
 *  3. A bare, already-correct `Name=Value; Name2=Value2` cookie header.
 *
 * Returns null if nothing cookie-shaped could be found.
 */

const MAX_INPUT_LENGTH = 5000;
const COOKIE_NAME_RE = /^[A-Za-z0-9_.\-]+$/;
const TABLE_HEADER_ROW_RE = /^\s*name\s*\t\s*value/i;

function tabSeparatedPairs(text) {
  const pairs = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('\t')) continue;
    if (TABLE_HEADER_ROW_RE.test(line)) continue;
    const [name, value] = line.split('\t');
    if (name && value && COOKIE_NAME_RE.test(name.trim())) {
      pairs.push([name.trim(), value.trim()]);
    }
  }
  return pairs;
}

function equalsSeparatedPairs(text) {
  const pairs = [];
  for (const token of text.split(/[;\n]+/)) {
    const match = /^\s*([A-Za-z0-9_.\-]+)\s*=\s*(.+?)\s*$/.exec(token);
    if (!match) continue;
    const [, name, value] = match;
    if (!COOKIE_NAME_RE.test(name)) continue;
    if (/:\/\//.test(value)) continue; // looks like a URL, not a cookie value
    pairs.push([name, value]);
  }
  return pairs;
}

/** @returns {string|null} */
export function extractCookieHeader(raw) {
  const text = String(raw ?? '')
    .trim()
    .slice(0, MAX_INPUT_LENGTH);
  if (!text) return null;

  let pairs = tabSeparatedPairs(text);

  if (pairs.length === 0) {
    const cookieLine = /^cookie\s*:\s*(.+)$/im.exec(text);
    pairs = equalsSeparatedPairs(cookieLine ? cookieLine[1] : text);
  }

  if (pairs.length === 0) return null;

  const seen = new Set();
  const deduped = [];
  for (const [name, value] of pairs) {
    if (seen.has(name)) continue;
    seen.add(name);
    deduped.push(`${name}=${value}`);
  }
  return deduped.join('; ');
}
