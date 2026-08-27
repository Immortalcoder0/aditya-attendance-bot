import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatMenu,
  formatOverall,
  formatSubjects,
  formatBunkReport,
  formatBelowTarget,
  formatSettings,
  formatDailySummary,
  formatLowAttendanceAlert,
} from './format.js';
import { parseAttendance } from '../portal/parse.js';
import { PROFILE_HTML } from '../portal/__fixtures__/profile.js';

const attendance = parseAttendance(PROFILE_HTML);
const TARGET = 0.75;

test('formatMenu flags an unlinked user and hides the warning once linked', () => {
  assert.match(formatMenu({ session: null }), /Not linked yet/);
  assert.doesNotMatch(formatMenu({ session: 'cookie=x' }), /Not linked yet/);
});

test('formatOverall reports the real total and how many classes must be attended', () => {
  const text = formatOverall(attendance, TARGET);
  assert.match(text, /66\.67%/);
  assert.match(text, /222\/333/);
  assert.match(text, /111/); // must attend 111 straight to reach 75% from 222/333
});

test('formatOverall says "can skip" once above target', () => {
  const safe = { total: { held: 100, attended: 90, percent: 90 } };
  const text = formatOverall(safe, TARGET);
  assert.match(text, /can skip/);
});

test('formatSubjects lists every subject with its percentage', () => {
  const text = formatSubjects(attendance, TARGET);
  for (const s of attendance.subjects) {
    assert.match(text, new RegExp(s.percent.toFixed(2).replace('.', '\\.')));
  }
  assert.match(text, /66\.67%/); // total line
});

test('formatBunkReport gives distinct advice for safe vs short subjects', () => {
  const text = formatBunkReport(attendance, TARGET);
  assert.match(text, /can skip \*15\*/); // 54/57 subject
  assert.match(text, /must attend \*42\* straight/); // 21/42 subject
});

test('formatBelowTarget lists only sub-target subjects, worst first', () => {
  const text = formatBelowTarget(attendance, TARGET);
  assert.match(text, /50\.00%/); // worst subject present
  assert.doesNotMatch(text, /94\.74%/); // best subject excluded
});

test('formatBelowTarget congratulates when nothing is below target', () => {
  const allGood = { subjects: [{ held: 10, attended: 10, name: 'X', code: 'X1' }] };
  assert.match(formatBelowTarget(allGood, TARGET), /Nice/);
});

test('formatSettings reflects target, daily summary, and link state', () => {
  const text = formatSettings({ target: 0.8, dailySummary: false, session: 'cookie=x' });
  assert.match(text, /80\.00%/);
  assert.match(text, /off/);
  assert.match(text, /yes/);
});

test('formatDailySummary calls out below-target subjects, worst three', () => {
  const text = formatDailySummary(attendance, TARGET);
  assert.match(text, /66\.67%/);
  assert.match(text, /Below target/);
});

test('formatDailySummary celebrates when everything is above target', () => {
  const allGood = { total: { held: 10, attended: 10, percent: 100 }, subjects: [] };
  assert.match(formatDailySummary(allGood, TARGET), /All subjects above target/);
});

test('formatLowAttendanceAlert names the subject and the recovery count', () => {
  const subject = { name: 'Computer Networks', held: 8, attended: 5, percent: 62.5 };
  const text = formatLowAttendanceAlert(subject, TARGET);
  assert.match(text, /Computer Networks/);
  assert.match(text, /62\.50%/);
});
