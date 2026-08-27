import { fetchAttendance, keepAlive, SessionExpiredError } from '../portal/client.js';
import { ensureSession, SessionResult } from '../portal/session.js';
import { extractCookieHeader } from './cookieInput.js';
import { renderAttendanceChart } from './chart.js';
import {
  formatMainMenu,
  formatSettingsMenu,
  formatTargetPrompt,
  formatTargetInvalid,
  formatUnlinkConfirm,
  formatOverall,
  formatSubjects,
  formatSubjectsCaption,
  formatBunkReport,
  formatBelowTarget,
  formatSessionExpired,
  formatLinkInstructions,
  formatLinkSuccess,
  formatLinkSuccessPending,
  formatLinkInvalid,
  formatLinkUnrecognized,
} from './format.js';

/**
 * Menu-driven command routing.
 *
 * The bot only ever initiates on "/start" — everything else is either a reply
 * to whatever menu/prompt was most recently shown (tracked per user in
 * `flow`), or gets silently ignored. There is no free-text command surface;
 * "/start" is the one and only entry point, by design.
 *
 * `flow` is in-memory, not persisted — a restart mid-flow just means the user
 * sends /start again, which is an acceptable reset.
 */

const Step = Object.freeze({
  MAIN_MENU: 'main_menu',
  SETTINGS_MENU: 'settings_menu',
  AWAITING_TARGET: 'awaiting_target',
  AWAITING_COOKIE: 'awaiting_cookie',
  AWAITING_UNLINK_CONFIRM: 'awaiting_unlink_confirm',
});

export function createCommandHandler({ store, log }) {
  const flow = new Map(); // waJid -> Step; absent = idle (only "/start" gets a reply)

  /**
   * Every data command hits the portal live rather than serving the stored
   * snapshot, because "is this current?" is the whole point of the bot.
   * @returns {{ok: true, attendance: object} | {ok: false, message: string, needsLink?: boolean}}
   */
  async function withAttendance(waJid) {
    const session = await ensureSession(store, waJid, log);

    if (session.status === SessionResult.NO_SESSION) {
      return { ok: false, needsLink: true, message: formatLinkInstructions() };
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

  /**
   * Linking only needs to confirm the cookie actually authenticates — that
   * check (a plain HTTP GET) has been completely reliable in practice, unlike
   * the heavier real-Chrome data fetch, which occasionally rejects an
   * otherwise-valid, freshly-created session for reasons still under
   * investigation. Requiring a full data fetch to succeed before saving the
   * session meant an account hitting that issue could never link at all —
   * and therefore never got the ongoing keepalive polling that might be
   * exactly what it needs. Save the session on auth success alone, and treat
   * the first data fetch as a bonus, not a gate.
   */
  async function tryLinkCookie(waJid, rawPaste) {
    const cookieHeader = extractCookieHeader(rawPaste);
    if (!cookieHeader) return { ok: false, message: formatLinkUnrecognized() };

    let alive, fresh;
    try {
      ({ alive, cookieHeader: fresh } = await keepAlive(cookieHeader));
    } catch (err) {
      log.warn({ err: err.message, waJid }, 'session validation failed');
      return {
        ok: false,
        message: "⚠️ Couldn't reach Campus Connect to validate that. Try pasting it again shortly.",
      };
    }
    if (!alive) return { ok: false, message: formatLinkInvalid() };

    await store.setSession(waJid, fresh);

    try {
      const { attendance, cookieHeader: fresher } = await fetchAttendance(fresh);
      if (fresher !== fresh) await store.setSession(waJid, fresher);
      await store.saveSnapshot(waJid, attendance);
      return { ok: true, message: formatLinkSuccess(attendance) };
    } catch (err) {
      log.warn({ err: err.message, waJid }, 'linked, but first data fetch failed');
      return { ok: true, message: formatLinkSuccessPending() };
    }
  }

  async function handleMainMenuReply(waJid, text, user) {
    const target = user.target ?? 0.75;

    if (['1', '2', '3', '4'].includes(text)) {
      const result = await withAttendance(waJid);
      if (!result.ok) {
        if (result.needsLink) flow.set(waJid, Step.AWAITING_COOKIE);
        return result.message;
      }

      if (text === '2') {
        // The chart is a nice-to-have on top of the real data, not a
        // replacement — if rendering it fails for any reason, fall back to
        // the plain-text breakdown rather than losing the reply entirely.
        try {
          const image = await renderAttendanceChart(result.attendance, target);
          return [{ image, caption: formatSubjectsCaption(result.attendance) }, formatMainMenu()];
        } catch (err) {
          log.warn({ err: err.message, waJid }, 'chart rendering failed, falling back to text');
          return [formatSubjects(result.attendance, target), formatMainMenu()];
        }
      }

      const formatted =
        text === '1'
          ? formatOverall(result.attendance, target)
          : text === '3'
            ? formatBunkReport(result.attendance, target)
            : formatBelowTarget(result.attendance, target);
      return [formatted, formatMainMenu()];
    }

    if (text === '5') {
      flow.set(waJid, Step.SETTINGS_MENU);
      return formatSettingsMenu(store.getUser(waJid) ?? user);
    }

    return null; // not a recognized option — stay silent rather than nag
  }

  async function handleSettingsMenuReply(waJid, text, user) {
    if (text === '1') {
      flow.set(waJid, Step.AWAITING_TARGET);
      return formatTargetPrompt();
    }
    if (text === '2') {
      await store.updateUser(waJid, { dailySummary: !user.dailySummary });
      return formatSettingsMenu(store.getUser(waJid));
    }
    if (text === '3') {
      flow.set(waJid, Step.AWAITING_COOKIE);
      return formatLinkInstructions();
    }
    if (text === '4') {
      flow.set(waJid, Step.AWAITING_UNLINK_CONFIRM);
      return formatUnlinkConfirm();
    }
    if (text === '5') {
      flow.set(waJid, Step.MAIN_MENU);
      return formatMainMenu();
    }
    return null;
  }

  async function handleAwaitingTarget(waJid, text) {
    const value = Number(text);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      return formatTargetInvalid();
    }
    await store.updateUser(waJid, { target: value / 100 });
    flow.set(waJid, Step.SETTINGS_MENU);
    return [`✅ Target set to *${value}%*.`, formatSettingsMenu(store.getUser(waJid))];
  }

  async function handleAwaitingCookie(waJid, text) {
    const result = await tryLinkCookie(waJid, text);
    if (result.ok) {
      flow.set(waJid, Step.MAIN_MENU);
      return [result.message, formatMainMenu()];
    }
    return result.message; // stay in AWAITING_COOKIE so a retry paste just works
  }

  async function handleUnlinkConfirm(waJid, text) {
    if (text === '1') {
      await store.forgetUser(waJid);
      flow.delete(waJid);
      return '🗑️ Done. Everything has been deleted. Send */start* to begin again.';
    }
    if (text === '2') {
      flow.set(waJid, Step.SETTINGS_MENU);
      return formatSettingsMenu(await store.ensureUser(waJid));
    }
    return null;
  }

  /** @returns {Promise<string|null>} reply text, or null to stay silent */
  async function handle(waJid, rawText) {
    const text = String(rawText ?? '').trim();
    const user = await store.ensureUser(waJid);

    // The one and only entry point — works from any state, resets the flow.
    if (text.toLowerCase() === '/start') {
      flow.set(waJid, Step.MAIN_MENU);
      return formatMainMenu();
    }

    const step = flow.get(waJid);
    if (!step) return null; // idle: nothing but "/start" gets a reply

    switch (step) {
      case Step.MAIN_MENU:
        return handleMainMenuReply(waJid, text, user);
      case Step.SETTINGS_MENU:
        return handleSettingsMenuReply(waJid, text, user);
      case Step.AWAITING_TARGET:
        return handleAwaitingTarget(waJid, text);
      case Step.AWAITING_COOKIE:
        return handleAwaitingCookie(waJid, text);
      case Step.AWAITING_UNLINK_CONFIRM:
        return handleUnlinkConfirm(waJid, text);
      default:
        return null;
    }
  }

  return { handle };
}
