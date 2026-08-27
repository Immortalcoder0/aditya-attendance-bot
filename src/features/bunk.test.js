import test from 'node:test';
import assert from 'node:assert/strict';

import { bunkAdvice, subjectsBelow, bunkReport } from './bunk.js';
import { parseAttendance } from '../portal/parse.js';
import { PROFILE_HTML } from '../portal/__fixtures__/profile.js';

test('safe subject reports how many classes can be skipped', () => {
  // 54/57 = 94.74%. Skipping 15 leaves 54/72 = exactly 75%.
  const advice = bunkAdvice({ held: 57, attended: 54 });
  assert.equal(advice.status, 'safe');
  assert.equal(advice.canSkip, 15);
  assert.equal(advice.mustAttend, 0);
});

test('skipping exactly canSkip stays at or above target', () => {
  const { held, attended } = { held: 57, attended: 54 };
  const { canSkip } = bunkAdvice({ held, attended });
  assert.ok(attended / (held + canSkip) >= 0.75);
  // And one more would drop below.
  assert.ok(attended / (held + canSkip + 1) < 0.75);
});

test('short subject reports how many classes must be attended', () => {
  // 21/42 = 50%. Attending 42 straight gives 63/84 = exactly 75%.
  const advice = bunkAdvice({ held: 42, attended: 21 });
  assert.equal(advice.status, 'short');
  assert.equal(advice.mustAttend, 42);
  assert.equal(advice.canSkip, 0);
});

test('attending exactly mustAttend reaches the target', () => {
  const { held, attended } = { held: 42, attended: 21 };
  const { mustAttend } = bunkAdvice({ held, attended });
  assert.ok((attended + mustAttend) / (held + mustAttend) >= 0.75);
});

test('overall total advice matches the live figures', () => {
  // 222/333 = 66.67%. Attending 111 straight gives 333/444 = 75%.
  const advice = bunkAdvice({ held: 333, attended: 222 });
  assert.equal(advice.status, 'short');
  assert.equal(advice.mustAttend, 111);
});

test('handles a 100% target without dividing by zero', () => {
  const perfect = bunkAdvice({ held: 10, attended: 10 }, 1);
  assert.equal(perfect.status, 'safe');

  const missed = bunkAdvice({ held: 10, attended: 9 }, 1);
  assert.equal(missed.status, 'unrecoverable');
  assert.ok(Number.isFinite(missed.mustAttend));
});

test('handles a subject with no classes held', () => {
  const advice = bunkAdvice({ held: 0, attended: 0 });
  assert.equal(advice.status, 'unknown');
  assert.equal(advice.canSkip, 0);
});

test('subjectsBelow returns only sub-target subjects, worst first', () => {
  const attendance = parseAttendance(PROFILE_HTML);
  const below = subjectsBelow(attendance);

  assert.ok(below.every((s) => s.attended / s.held < 0.75));
  assert.equal(below[0].code, '241AI014'); // 50.00%, the worst

  const ratios = below.map((s) => s.attended / s.held);
  assert.deepEqual(ratios, [...ratios].sort((a, b) => a - b));

  // The two subjects at or above 75% must be excluded.
  const codes = below.map((s) => s.code);
  assert.ok(!codes.includes('241AI005')); // 94.74%
});

test('bunkReport covers every subject plus the total', () => {
  const attendance = parseAttendance(PROFILE_HTML);
  const report = bunkReport(attendance);
  assert.equal(report.subjects.length, attendance.subjects.length);
  assert.ok(report.subjects.every((s) => s.advice));
  assert.equal(report.total.advice.status, 'short');
});
