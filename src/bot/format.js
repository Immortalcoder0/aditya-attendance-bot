import { bunkAdvice, subjectsBelow } from '../features/bunk.js';

/**
 * WhatsApp message rendering.
 *
 * WhatsApp supports *bold*, _italic_ and ```monospace``` blocks. Tabular data goes
 * in a monospace block so columns line up on a phone.
 */

const pct = (n) => `${Number(n).toFixed(2)}%`;

function statusIcon(ratio, target) {
  if (ratio >= target + 0.1) return '🟢';
  if (ratio >= target) return '🟡';
  return '🔴';
}

/** Trim a course name to keep monospace rows from wrapping on narrow screens. */
function shortName(name, max = 22) {
  const clean = String(name ?? '').replace(/\s*\(minor Stream\)\s*/i, '');
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function formatMenu(user) {
  const linked = Boolean(user?.session);
  const lines = [
    '*📚 Attendance Bot*',
    '',
    'Reply with a number:',
    '',
    '*1* · Overall attendance',
    '*2* · Subject-wise breakdown',
    '*3* · Bunk calculator',
    '*4* · Subjects below target',
    '*5* · Settings',
    '',
  ];
  if (!linked) {
    lines.push('⚠️ Not linked yet — send *link* to see how to connect your Campus Connect account.');
  }
  return lines.join('\n');
}

export function formatOverall(attendance, target) {
  const { total } = attendance;
  const ratio = total.held > 0 ? total.attended / total.held : 0;
  const advice = bunkAdvice(total, target);

  const lines = [
    `${statusIcon(ratio, target)} *Overall attendance*`,
    '',
    `*${pct(total.percent)}*  (${total.attended}/${total.held} classes)`,
    `Target: ${pct(target * 100)}`,
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
  const rows = attendance.subjects.map((s) => {
    const ratio = s.held > 0 ? s.attended / s.held : 0;
    const name = shortName(s.name).padEnd(23);
    const counts = `${s.attended}/${s.held}`.padEnd(8);
    return `${statusIcon(ratio, target)} ${name}${counts}${pct(s.percent).padStart(7)}`;
  });

  return [
    '*📋 Subject-wise attendance*',
    '',
    '```',
    ...rows,
    '```',
    `*Total:* ${attendance.total.attended}/${attendance.total.held} · ${pct(attendance.total.percent)}`,
    '',
    `_Live from Campus Connect · ${formatTime(attendance.fetchedAt)}_`,
  ].join('\n');
}

export function formatBunkReport(attendance, target) {
  const lines = ['*🎯 Bunk calculator*', `_Target: ${pct(target * 100)}_`, ''];

  for (const s of attendance.subjects) {
    const advice = bunkAdvice(s, target);
    const ratio = s.held > 0 ? s.attended / s.held : 0;
    const head = `${statusIcon(ratio, target)} *${shortName(s.name, 30)}* — ${pct(s.percent)}`;

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
    lines.push(`• *${shortName(s.name, 30)}* — ${pct(s.percent)} (${s.attended}/${s.held})`);
    lines.push(`   attend *${advice.mustAttend}* straight to recover`);
  }
  return lines.join('\n');
}

export function formatSettings(user) {
  return [
    '*⚙️ Settings*',
    '',
    `Target: *${pct((user.target ?? 0.75) * 100)}*`,
    `Daily summary: *${user.dailySummary ? 'on' : 'off'}*`,
    `Account linked: *${user.session ? 'yes' : 'no'}*`,
    '',
    'Commands:',
    '• *target 80* — change your target %',
    '• *daily on* / *daily off* — daily summary',
    '• *link* — how to (re)connect your session',
    '• *unlink* — delete everything this bot has stored about you',
  ].join('\n');
}

export function formatDailySummary(attendance, target) {
  const below = subjectsBelow(attendance, target);
  const head = `*📅 Daily attendance summary*\n\n*${pct(attendance.total.percent)}* overall (${attendance.total.attended}/${attendance.total.held})`;
  if (below.length === 0) return `${head}\n\n✅ All subjects above target.`;
  const worst = below
    .slice(0, 3)
    .map((s) => `• ${shortName(s.name, 28)} — ${pct(s.percent)}`)
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
    'Send *link* to see how to reconnect — it takes about a minute.',
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
    '5. Paste it here after the word "session":',
    '```',
    'session PASTE_HERE',
    '```',
    '',
    "_I'll pull out what I need automatically, however messy the paste is. DevTools isn't available on phone browsers, so this needs a computer — but only this one time. Once linked, I keep the session alive on my own for as long as this bot keeps running._",
  ].join('\n');
}

export function formatLinkSuccess(attendance) {
  return [
    '✅ *Session linked!*',
    '',
    `Current overall attendance: *${pct(attendance.total.percent)}*`,
    '',
    'Send *menu* to see what I can do.',
  ].join('\n');
}

export function formatLinkInvalid() {
  return [
    "❌ I found something cookie-shaped in that, but it looks invalid or already expired.",
    '',
    "Make sure you're copying from a tab where you're currently logged in, then resend: *session PASTE_HERE*",
  ].join('\n');
}

export function formatLinkUnrecognized() {
  return [
    "🤔 I couldn't find anything cookie-shaped in that paste.",
    '',
    "Send *link* to see the steps again — copying the whole *Headers* panel or the whole *Application → Cookies* table both work, so grab more rather than less.",
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
