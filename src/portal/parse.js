import * as cheerio from 'cheerio';

/**
 * Parsing for the Campus Connect student profile page.
 *
 * Verified against the live page on 2026-08-27:
 *   URL       Academics/StudentProfile.aspx?scrid=17
 *   container #divProfile_Present
 *   table     table.reportTable
 *   header    6 TDs (not THs): Sl.No. | Course | Faculty | Held | Attend | %
 *   subject   6 TDs
 *   total     4 TDs, first one colspan=3: TOTAL | held | attend | %
 */

const SUBJECT_CELLS = 6;
const TOTAL_CELLS = 4;

export class SessionExpiredError extends Error {
  constructor(message = 'Campus Connect session is no longer valid') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class AttendanceUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AttendanceUnavailableError';
  }
}

function toNumber(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** "241AI005-Machine Learning" -> { code, name }. Splits on the first hyphen only,
 *  because names legitimately contain hyphens ("Employability Skill-IV"). */
function splitLabelled(raw) {
  const text = String(raw ?? '').trim();
  const match = /^([^-\s][^-]*?)\s*-\s*([\s\S]+)$/.exec(text);
  if (!match) return { code: null, name: text };
  return { code: match[1].trim(), name: match[2].trim().replace(/\s+/g, ' ') };
}

/**
 * The portal answers an unauthenticated request by serving the login page (or
 * redirecting to it) rather than a 401, so expiry has to be sniffed from the body.
 */
export function isLoggedOut(html) {
  if (!html) return true;
  const $ = cheerio.load(html);
  if ($('#txtUserId').length && $('#txtPassword').length) return true;
  if ($('input[name="cf-turnstile-response"]').length) return true;
  return false;
}

function findAttendanceTable($) {
  const scoped = $('#divProfile_Present table.reportTable');
  if (scoped.length) return scoped.first();

  // Fall back to any reportTable whose header carries the attendance columns,
  // so a container rename upstream doesn't take the bot down.
  const candidates = $('table.reportTable').filter((_, el) => {
    const header = $(el).find('tr').first().text();
    return /Held/i.test(header) && /Attend/i.test(header);
  });
  return candidates.length ? candidates.first() : null;
}

/**
 * @param {string} html raw HTML of StudentProfile.aspx
 * @returns {{subjects: Array, total: object, fetchedAt: string}}
 */
export function parseAttendance(html) {
  if (isLoggedOut(html)) throw new SessionExpiredError();

  const $ = cheerio.load(html);
  const table = findAttendanceTable($);
  if (!table) {
    throw new AttendanceUnavailableError(
      'Attendance table not found — the portal layout may have changed'
    );
  }

  const subjects = [];
  let total = null;

  table.find('tr').each((index, row) => {
    const cells = $(row)
      .find('td')
      .map((_, td) => $(td).text().trim().replace(/\s+/g, ' '))
      .get();

    if (cells.length === 0) return;

    const first = cells[0];
    if (/^sl\.?\s*no/i.test(first)) return; // header

    if (/^total$/i.test(first) && cells.length >= TOTAL_CELLS) {
      const [held, attended, percent] = cells.slice(-3).map(toNumber);
      total = { held, attended, percent };
      return;
    }

    if (cells.length !== SUBJECT_CELLS) return;

    const held = toNumber(cells[3]);
    const attended = toNumber(cells[4]);
    if (held === null || attended === null) return;

    const course = splitLabelled(cells[1]);
    const faculty = splitLabelled(cells[2]);

    subjects.push({
      slNo: toNumber(cells[0]),
      code: course.code,
      name: course.name,
      facultyId: faculty.code,
      faculty: faculty.name,
      held,
      attended,
      // Trust our own arithmetic over the rendered string, but keep the portal's
      // value so a mismatch is debuggable.
      percent: held > 0 ? round2((attended / held) * 100) : 0,
      reportedPercent: toNumber(cells[5]),
    });
  });

  if (subjects.length === 0) {
    throw new AttendanceUnavailableError('Attendance table contained no subject rows');
  }

  if (!total) total = deriveTotal(subjects);

  return { subjects, total, fetchedAt: new Date().toISOString() };
}

function deriveTotal(subjects) {
  const held = subjects.reduce((sum, s) => sum + s.held, 0);
  const attended = subjects.reduce((sum, s) => sum + s.attended, 0);
  return {
    held,
    attended,
    percent: held > 0 ? round2((attended / held) * 100) : 0,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
