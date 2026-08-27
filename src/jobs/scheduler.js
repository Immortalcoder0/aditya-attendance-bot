import cron from 'node-cron';

import { config } from '../config.js';
import { fetchAttendance } from '../portal/client.js';
import { ensureSession, SessionResult } from '../portal/session.js';
import { subjectsBelow } from '../features/bunk.js';
import { formatLowAttendanceAlert, formatDailySummary, formatSessionExpired } from '../bot/format.js';

/**
 * Background loop: keeps every linked user's session alive with plain
 * authenticated polling (never touches Turnstile — see session.js for why
 * there's no automated login to retry here), watches for subjects crossing
 * below target, and sends a daily summary.
 *
 * A dead session is only messaged once per episode — `notifiedExpired` is
 * in-memory and resets on restart, which just means a rare duplicate notice
 * after a deploy rather than silence.
 */

const notifiedExpired = new Set();

export async function pollUser(store, sendReply, log, user) {
  const session = await ensureSession(store, user.waJid, log);

  if (session.status === SessionResult.OK) {
    notifiedExpired.delete(user.waJid);
    try {
      const { attendance, cookieHeader } = await fetchAttendance(session.cookieHeader);
      if (cookieHeader !== session.cookieHeader) await store.setSession(user.waJid, cookieHeader);
      await store.saveSnapshot(user.waJid, attendance);
      await checkLowAttendance(store, sendReply, user, attendance);
      log.info({ waJid: user.waJid }, 'poll ok, session kept alive');
    } catch (err) {
      log.warn({ err: err.message, waJid: user.waJid }, 'background attendance fetch failed');
    }
    return;
  }

  if (session.status === SessionResult.NO_SESSION) {
    if (notifiedExpired.has(user.waJid)) return; // already told them this episode
    notifiedExpired.add(user.waJid);
    await sendReply(user.waJid, formatSessionExpired());
  }
  // ERROR (portal unreachable): stay quiet, it's likely transient — the user
  // only hears about it when they actually ask for data.
}

export async function checkLowAttendance(store, sendReply, user, attendance) {
  const target = user.target ?? config.attendance.target;
  const below = subjectsBelow(attendance, target);
  const now = Date.now();
  const cooldown = config.attendance.alertCooldownMs;
  const lastAlertAt = { ...(user.lastAlertAt ?? {}) };
  let changed = false;

  for (const subject of below) {
    const key = subject.code ?? subject.name;
    const last = lastAlertAt[key] ? Date.parse(lastAlertAt[key]) : 0;
    if (now - last < cooldown) continue;

    await sendReply(user.waJid, formatLowAttendanceAlert(subject, target));
    lastAlertAt[key] = new Date(now).toISOString();
    changed = true;
  }

  if (changed) await store.updateUser(user.waJid, { lastAlertAt });
}

export function startScheduler({ store, sendReply, log }) {
  const pollTimer = setInterval(async () => {
    for (const user of store.linkedUsers()) {
      await pollUser(store, sendReply, log, user).catch((err) =>
        log.error({ err: err.message, waJid: user.waJid }, 'poll failed')
      );
    }
  }, config.keepAliveIntervalMs);

  const dailyTask = cron.schedule(
    config.schedule.dailySummaryCron,
    async () => {
      for (const user of store.linkedUsers()) {
        if (!user.dailySummary) continue;
        const session = await ensureSession(store, user.waJid, log);
        if (session.status !== SessionResult.OK) continue;
        try {
          const { attendance, cookieHeader } = await fetchAttendance(session.cookieHeader);
          if (cookieHeader !== session.cookieHeader) await store.setSession(user.waJid, cookieHeader);
          await store.saveSnapshot(user.waJid, attendance);
          const target = user.target ?? config.attendance.target;
          await sendReply(user.waJid, formatDailySummary(attendance, target));
        } catch (err) {
          log.warn({ err: err.message, waJid: user.waJid }, 'daily summary failed');
        }
      }
    },
    { timezone: config.schedule.timezone }
  );

  return {
    stop() {
      clearInterval(pollTimer);
      dailyTask.stop();
    },
  };
}
