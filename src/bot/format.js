import { bunkAdvice, subjectsBelow } from '../features/bunk.js';

/**
 * WhatsApp message rendering.
 *
 * WhatsApp supports *bold*, _italic_ and ```monospace``` blocks, but monospace
 * columns padded with spaces don't reliably line up on a phone — WhatsApp's
 * font isn't perfectly fixed-width on every device, so padded alignment can
 * come out ragged. Per-subject blocks (icon + full name on one line, numbers
 * on the next) sidestep that entirely and never need to truncate a name.
 */

const pct = (n) => `${Number(n).toFixed(2)}%`;

function statusIcon(ratio, target) {
  if (ratio >= target + 0.1) return '🟢';
  if (ratio >= target) return '🟡';
  return '🔴';
}

/** Drop the redundant "(minor Stream)" suffix some course names carry. */
function cleanName(name) {
  return String(name ?? '').replace(/\s*\(minor Stream\)\s*/i, '');
}

/** Block-character fill bar — renders as a real visual, no image needed. */
function progressBar(ratio, size = 10) {
  const filled = Math.max(0, Math.min(size, Math.round(ratio * size)));
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

export function formatMainMenu() {
  return [
    '*📚 Attendance Bot*',
    '',
    'Reply with a number:',
    '',
    '*1* · Overall attendance',
    '*2* · Subject-wise breakdown',
    '*3* · Bunk calculator',
    '*4* · Subjects below target',
    '*5* · Settings',
  ].join('\n');
}

export function formatSettingsMenu(user) {
  return [
    '*⚙️ Settings*',
    '',
    `Target: *${pct((user.target ?? 0.75) * 100)}*`,
    `Daily summary: *${user.dailySummary ? 'on' : 'off'}*`,
    `Account linked: *${user.session ? 'yes' : 'no'}*`,
    '',
    'Reply with a number:',
    '',
    '*1* · Change target %',
    '*2* · Toggle daily summary',
    '*3* · Link / relink account',
    '*4* · Unlink (delete everything)',
    '*5* · Back to menu',
  ].join('\n');
}

export function formatTargetPrompt() {
  return 'Reply with your new target as a number between 1 and 100 (e.g. *80*).';
}

export function formatTargetInvalid() {
  return "That's not a number between 1 and 100 — try again, or send */start* to cancel.";
}

export function formatUnlinkConfirm() {
  return [
    '⚠️ *Delete everything?*',
    '',
    "This removes your session and all settings this bot has stored about you. You'll need to relink from scratch.",
    '',
    '*1* · Yes, delete everything',
    '*2* · Cancel',
  ].join('\n');
}

export function formatOverall(attendance, target) {
  const { total } = attendance;
  const ratio = total.held > 0 ? total.attended / total.held : 0;
  const advice = bunkAdvice(total, target);

  const lines = [
    `${statusIcon(ratio, target)} *Overall attendance*`,
    '',
    `${progressBar(ratio)}  *${pct(total.percent)}*`,
    `(${total.attended}/${total.held} classes) · Target: ${pct(target * 100)}`,
    '',
  ];

  if (advice.status === 'safe') {
    lines.push(
      advice.canSkip > 0
        ? `✅ You can skip *${advice.canSkip}* more class${advice.canSkip === 1 ? '' : 'es'} and stay above target.`
        : '⚠️ You are exactly at target — skipping even one class drops you below.'
    );
  } else if (advice.status === 'short') {
    lines.push(
      `❌ Below target. Attend *${advice.mustAttend}* class${advice.mustAttend === 1 ? '' : 'es'} in a row to recover.`
    );
  }

  lines.push('', `_Live from Campus Connect · ${formatTime(attendance.fetchedAt)}_`);
  return lines.join('\n');
}

export function formatSubjects(attendance, target) {
  const lines = ['*📋 Subject-wise attendance*', ''];

  for (const s of attendance.subjects) {
    const ratio = s.held > 0 ? s.attended / s.held : 0;
    lines.push(`${statusIcon(ratio, target)} *${cleanName(s.name)}*`);
    lines.push(`${progressBar(ratio)}  ${s.attended}/${s.held} · ${pct(s.percent)}`);
  }

  lines.push(
    '',
    `*Total:* ${attendance.total.attended}/${attendance.total.held} · ${pct(attendance.total.percent)}`,
    '',
    `_Live from Campus Connect · ${formatTime(attendance.fetchedAt)}_`
  );
  return lines.join('\n');
}

export function formatBunkReport(attendance, target) {
  const lines = ['*🎯 Bunk calculator*', `_Target: ${pct(target * 100)}_`, ''];

  for (const s of attendance.subjects) {
    const advice = bunkAdvice(s, target);
    const ratio = s.held > 0 ? s.attended / s.held : 0;
    const head = `${statusIcon(ratio, target)} *${cleanName(s.name)}* — ${pct(s.percent)}`;

    if (advice.status === 'safe') {
      lines.push(head, `   can skip *${advice.canSkip}*`);
    } else if (advice.status === 'short') {
      lines.push(head, `   must attend *${advice.mustAttend}* straight`);
    } else {
      lines.push(head, '   no classes held yet');
    }
  }

  const totalAdvice = bunkAdvice(attendance.total, target);
  lines.push(
    '',
    totalAdvice.status === 'safe'
      ? `*Overall:* can skip *${totalAdvice.canSkip}*`
      : `*Overall:* must attend *${totalAdvice.mustAttend}* straight`
  );

  return lines.join('\n');
}

export function formatBelowTarget(attendance, target) {
  const below = subjectsBelow(attendance, target);
  if (below.length === 0) {
    return `✅ Every subject is at or above ${pct(target * 100)}. Nice.`;
  }

  const lines = [`🔴 *${below.length} subject${below.length === 1 ? '' : 's'} below ${pct(target * 100)}*`, ''];
  for (const s of below) {
    const advice = bunkAdvice(s, target);
    lines.push(`• *${cleanName(s.name)}* — ${pct(s.percent)} (${s.attended}/${s.held})`);
    lines.push(`   attend *${advice.mustAttend}* straight to recover`);
  }
  return lines.join('\n');
}

export function formatDailySummary(attendance, target) {
  const below = subjectsBelow(attendance, target);
  const head = `*📅 Daily attendance summary*\n\n*${pct(attendance.total.percent)}* overall (${attendance.total.attended}/${attendance.total.held})`;
  if (below.length === 0) return `${head}\n\n✅ All subjects above target.`;
  const worst = below
    .slice(0, 3)
    .map((s) => `• ${cleanName(s.name)} — ${pct(s.percent)}`)
    .join('\n');
  return `${head}\n\n🔴 Below target:\n${worst}`;
}

export function formatLowAttendanceAlert(subject, target) {
  const advice = bunkAdvice(subject, target);
  return [
    '🚨 *Low attendance alert*',
    '',
    `*${subject.name}* has dropped to *${pct(subject.percent)}*`,
    `(${subject.attended}/${subject.held} classes)`,
    '',
    `Attend *${advice.mustAttend}* class${advice.mustAttend === 1 ? '' : 'es'} in a row to get back to ${pct(target * 100)}.`,
  ].join('\n');
}

export function formatSessionExpired() {
  return [
    '🔒 *Your Campus Connect session expired*',
    '',
    'Send */start* → Settings → Link / relink account to reconnect — it takes about a minute.',
  ].join('\n');
}

export function formatLinkInstructions() {
  return [
    '*🔗 Link your Campus Connect account*',
    '',
    "This bot never asks for your password — you log in yourself, and hand it your existing session instead. Takes about a minute, one time:",
    '',
    '1. On a *computer*, log into Campus Connect as usual.',
    '2. Press *F12* to open DevTools.',
    '3. Go to *Network* → click any request → *Headers* tab, *or* go to *Application* → *Cookies* → the info.aec.edu.in row.',
    '4. Select everything you see there and copy it — don\'t worry about being precise, grab the whole block.',
    '5. Paste it here as your next message.',
    '',
    "_I'll pull out what I need automatically, however messy the paste is. DevTools isn't available on phone browsers, so this needs a computer — but only this one time. Once linked, I keep the session alive on my own for as long as this bot keeps running._",
  ].join('\n');
}

export function formatLinkSuccess(attendance) {
  return [
    '✅ *Session linked!*',
    '',
    `Current overall attendance: *${pct(attendance.total.percent)}*`,
  ].join('\n');
}

export function formatLinkInvalid() {
  return [
    "❌ I found something cookie-shaped in that, but it looks invalid or already expired.",
    '',
    "Make sure you're copying from a tab where you're currently logged in, then paste it again.",
  ].join('\n');
}

export function formatLinkUnrecognized() {
  return [
    "🤔 I couldn't find anything cookie-shaped in that paste.",
    '',
    "Copying the whole *Headers* panel or the whole *Application → Cookies* table both work, so grab more rather than less — try pasting again.",
  ].join('\n');
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
