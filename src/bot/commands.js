import { fetchAttendance, SessionExpiredError } from '../portal/client.js';
import { ensureSession, SessionResult } from '../portal/session.js';
import { extractCookieHeader } from './cookieInput.js';
import {
  formatMenu,
  formatOverall,
  formatSubjects,
  formatBunkReport,
  formatBelowTarget,
  formatSettings,
  formatSessionExpired,
  formatLinkInstructions,
  formatLinkSuccess,
  formatLinkInvalid,
  formatLinkUnrecognized,
} from './format.js';

/**
 * Command routing for incoming WhatsApp messages.
 *
 * Every data command hits the portal live rather than serving the stored snapshot,
 * because "is this current?" is the whole point of the bot. The snapshot exists
 * only for alerts and for answering when the portal is unreachable.
 */

const SESSION_MESSAGE_RE = /^session\s+(.+)$/is;

export function createCommandHandler({ store, log }) {
  /**
   * Make sure a usable session exists, then fetch live attendance through it.
   * @returns {{ok: true, attendance: object} | {ok: false, message: string}}
   */
  async function withAttendance(waJid) {
    const session = await ensureSession(store, waJid, log);

    if (session.status === SessionResult.NO_SESSION) {
      return { ok: false, message: formatLinkInstructions() };
    }
    if (session.status === SessionResult.ERROR) {
      const user = store.getUser(waJid);
      if (user?.lastSnapshot) {
        return {
          ok: false,
          message:
            "⚠️ Campus Connect isn't responding right now, so I can't fetch live data.\n\n" +
            `Last known: *${user.lastSnapshot.total.percent.toFixed(2)}%* ` +
            `(${user.lastSnapshot.total.attended}/${user.lastSnapshot.total.held})\n` +
            `_as of ${new Date(user.lastSnapshot.fetchedAt).toLocaleString('en-IN')}_`,
        };
      }
      return { ok: false, message: "⚠️ Campus Connect isn't responding right now. Try again shortly." };
    }

    try {
      const { attendance, cookieHeader } = await fetchAttendance(session.cookieHeader);
      if (cookieHeader !== session.cookieHeader) await store.setSession(waJid, cookieHeader);
      await store.saveSnapshot(waJid, attendance);
      return { ok: true, attendance };
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        await store.clearSession(waJid);
        return { ok: false, message: formatSessionExpired() };
      }
      log.warn({ err: err.message, waJid }, 'attendance fetch failed');
      return { ok: false, message: "⚠️ Campus Connect isn't responding right now. Try again shortly." };
    }
  }

  async function handleSessionLink(waJid, rawPaste) {
    const cookieHeader = extractCookieHeader(rawPaste);
    if (!cookieHeader) return formatLinkUnrecognized();

    try {
      const { attendance, cookieHeader: freshCookieHeader } = await fetchAttendance(cookieHeader);
      await store.setSession(waJid, freshCookieHeader);
      await store.saveSnapshot(waJid, attendance);
      return formatLinkSuccess(attendance);
    } catch (err) {
      if (err instanceof SessionExpiredError) return formatLinkInvalid();
      log.warn({ err: err.message, waJid }, 'session validation failed');
      return "⚠️ Couldn't reach Campus Connect to validate that. Try again shortly.";
    }
  }

  /** @returns {Promise<string|null>} reply text, or null to stay silent */
  async function handle(waJid, rawText) {
    const text = String(rawText ?? '').trim();
    const lower = text.toLowerCase();
    const user = await store.ensureUser(waJid);
    const target = user.target ?? 0.75;

    // --- linking -----------------------------------------------------------
    const sessionMatch = SESSION_MESSAGE_RE.exec(text);
    if (sessionMatch) {
      return handleSessionLink(waJid, sessionMatch[1].trim());
    }
    if (lower === 'link' || lower === 'relink') {
      return formatLinkInstructions();
    }

    if (lower === 'unlink' || lower === 'delete me' || lower === 'forget me') {
      await store.forgetUser(waJid);
      return '🗑️ Done. Your session and all stored data have been deleted.';
    }

    // --- settings ----------------------------------------------------------
    const targetMatch = /^target\s+(\d{1,3})%?$/.exec(lower);
    if (targetMatch) {
      const value = Number(targetMatch[1]);
      if (value < 1 || value > 100) return '⚠️ Target must be between 1 and 100.';
      await store.updateUser(waJid, { target: value / 100 });
      return `✅ Target set to *${value}%*.`;
    }

    if (lower === 'daily on' || lower === 'daily off') {
      const on = lower.endsWith('on');
      await store.updateUser(waJid, { dailySummary: on });
      return `✅ Daily summary turned *${on ? 'on' : 'off'}*.`;
    }

    // --- data --------------------------------------------------------------
    if (lower === '1' || lower === 'attendance' || lower === 'overall') {
      const result = await withAttendance(waJid);
      return result.ok ? formatOverall(result.attendance, target) : result.message;
    }

    if (lower === '2' || lower === 'subjects' || lower === 'subject') {
      const result = await withAttendance(waJid);
      return result.ok ? formatSubjects(result.attendance, target) : result.message;
    }

    if (lower === '3' || lower === 'bunk' || lower === 'bunks') {
      const result = await withAttendance(waJid);
      return result.ok ? formatBunkReport(result.attendance, target) : result.message;
    }

    if (lower === '4' || lower === 'low' || lower === 'below') {
      const result = await withAttendance(waJid);
      return result.ok ? formatBelowTarget(result.attendance, target) : result.message;
    }

    if (lower === '5' || lower === 'settings') {
      return formatSettings(store.getUser(waJid) ?? user);
    }

    if (['hi', 'hey', 'hello', 'menu', 'help', 'start', '0'].includes(lower)) {
      return formatMenu(store.getUser(waJid) ?? user);
    }

    // Unknown input: show the menu rather than an error, so the bot is
    // discoverable for someone who has never used it.
    return formatMenu(store.getUser(waJid) ?? user);
  }

  return { handle, withAttendance };
}
