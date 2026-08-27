/**
 * Bunk math.
 *
 * Given `attended` of `held` classes and a target ratio T:
 *
 *   Safe to skip k more:   attended / (held + k) >= T   ->  k <= attended/T - held
 *   Must attend k more:  (attended + k) / (held + k) >= T -> k >= (T*held - attended) / (1 - T)
 *
 * Both assume every future class is either skipped or attended, which is the
 * standard "can I bunk tomorrow" question students actually ask.
 */

export const DEFAULT_TARGET = 0.75;

export function bunkAdvice({ held, attended }, target = DEFAULT_TARGET) {
  if (!Number.isFinite(held) || held <= 0) {
    return { status: 'unknown', percent: 0, canSkip: 0, mustAttend: 0, target };
  }

  const ratio = attended / held;
  const percent = Math.round(ratio * 10000) / 100;

  // A target of 100% can never be recovered from once you've missed one, and the
  // mustAttend formula divides by (1 - target), so handle it separately.
  if (target >= 1) {
    return {
      status: ratio >= 1 ? 'safe' : 'unrecoverable',
      percent,
      canSkip: 0,
      mustAttend: 0,
      target,
    };
  }

  if (ratio >= target) {
    const canSkip = Math.max(0, Math.floor(attended / target - held));
    return { status: 'safe', percent, canSkip, mustAttend: 0, target };
  }

  const mustAttend = Math.max(0, Math.ceil((target * held - attended) / (1 - target)));
  return { status: 'short', percent, canSkip: 0, mustAttend, target };
}

/** Advice for every subject plus the overall total. */
export function bunkReport(attendance, target = DEFAULT_TARGET) {
  return {
    target,
    subjects: attendance.subjects.map((s) => ({
      ...s,
      advice: bunkAdvice(s, target),
    })),
    total: { ...attendance.total, advice: bunkAdvice(attendance.total, target) },
  };
}

/** Subjects sitting below `target`, worst first. */
export function subjectsBelow(attendance, target = DEFAULT_TARGET) {
  return attendance.subjects
    .filter((s) => s.held > 0 && s.attended / s.held < target)
    .sort((a, b) => a.attended / a.held - b.attended / b.held);
}
