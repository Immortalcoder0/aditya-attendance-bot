import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAttendance, isLoggedOut, SessionExpiredError, AttendanceUnavailableError } from './parse.js';
import {
  PROFILE_HTML,
  LOGIN_HTML,
  EXPECTED_TOTAL,
  EXPECTED_SUBJECT_COUNT,
} from './__fixtures__/profile.js';

test('parses every subject row', () => {
  const { subjects } = parseAttendance(PROFILE_HTML);
  assert.equal(subjects.length, EXPECTED_SUBJECT_COUNT);
});

test('reads the portal total row rather than re-deriving it', () => {
  const { total } = parseAttendance(PROFILE_HTML);
  assert.deepEqual(total, EXPECTED_TOTAL);
});

test('subject held/attended sums match the portal total', () => {
  const { subjects, total } = parseAttendance(PROFILE_HTML);
  assert.equal(subjects.reduce((s, x) => s + x.held, 0), total.held);
  assert.equal(subjects.reduce((s, x) => s + x.attended, 0), total.attended);
});

test('splits course code from name on the first hyphen only', () => {
  const { subjects } = parseAttendance(PROFILE_HTML);

  const ml = subjects.find((s) => s.code === '241AI005');
  assert.equal(ml.name, 'Machine Learning');

  // Name legitimately contains a hyphen.
  const skill = subjects.find((s) => s.code === '241UC015');
  assert.equal(skill.name, 'Employability Skill-IV');

  // Name contains " - " with spaces.
  const cv = subjects.find((s) => s.code === '241AI007');
  assert.equal(cv.name, 'Computer Vision - Ca (minor Stream)');

  // Name starts with a hyphenated fragment.
  const sc = subjects.find((s) => s.code === '241AI014');
  assert.equal(sc.name, 'Soft Computing -mi,ca (minor Stream)');
});

test('splits faculty id from faculty name, including single-digit ids', () => {
  const { subjects } = parseAttendance(PROFILE_HTML);
  const econ = subjects.find((s) => s.code === '241MB001');
  assert.equal(econ.facultyId, '5');
  assert.equal(econ.faculty, 'DR. N.VISALAKSHI');
});

test('computed percent agrees with the portal percent', () => {
  const { subjects } = parseAttendance(PROFILE_HTML);
  for (const s of subjects) {
    assert.ok(
      Math.abs(s.percent - s.reportedPercent) < 0.01,
      `${s.code}: computed ${s.percent} vs reported ${s.reportedPercent}`
    );
  }
});

test('detects the login page as logged out', () => {
  assert.equal(isLoggedOut(LOGIN_HTML), true);
  assert.equal(isLoggedOut(PROFILE_HTML), false);
  assert.equal(isLoggedOut(''), true);
});

test('throws SessionExpiredError when handed the login page', () => {
  assert.throws(() => parseAttendance(LOGIN_HTML), SessionExpiredError);
});

test('throws AttendanceUnavailableError when the table is missing', () => {
  const html = '<html><body><div id="divProfile_Present"></div></body></html>';
  assert.throws(() => parseAttendance(html), AttendanceUnavailableError);
});

test('finds the table even if the container is renamed', () => {
  const moved = PROFILE_HTML.replace('divProfile_Present', 'divProfile_Renamed');
  const { subjects } = parseAttendance(moved);
  assert.equal(subjects.length, EXPECTED_SUBJECT_COUNT);
});
