/**
 * Fixture mirroring the real StudentProfile.aspx markup captured on 2026-08-27.
 * Structure (header 6 TDs, subject rows 6 TDs, total row 4 TDs with colspan=3)
 * and the numbers are taken from the live page, so the expected totals below are
 * the portal's own.
 */

const ROWS = [
  [1, '241AI005-Machine Learning', '5237-DR. SUNEETHA RACHARLA', 57, 54, '94.74'],
  [2, '241CS007-Computer Networks', '5671-SUNKAVILLI VIJAYA NIRMALA', 8, 5, '62.50'],
  [3, '241MB001-Engineering Economics & Management', '5-DR. N.VISALAKSHI', 18, 13, '72.22'],
  [4, '241UC015-Employability Skill-IV', '5994-MATCHA VIJAYA KUMAR', 51, 30, '58.82'],
  [5, '241CS017-Object Oriented Analysis & Design Using Uml', '5671-SUNKAVILLI VIJAYA NIRMALA', 38, 26, '68.42'],
  [6, '241AI007-Computer Vision - Ca (minor Stream)', '4665-DUNE SATYANARAYANA', 39, 23, '58.97'],
  [7, '241AI024-Api & Micro Services - Ca, Mad (minor Stream)', '6543-DR. NITTA RAHUL PAL', 80, 50, '62.50'],
  [8, '241AI014-Soft Computing -mi,ca (minor Stream)', '2248-DR.KURUMETI NAGA SURYA LAKSHMANA KUMAR', 42, 21, '50.00'],
];

const bodyRows = ROWS.map(
  (r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`
).join('\n');

export const PROFILE_HTML = `<!DOCTYPE html>
<html><body><form id="aspnetForm">
<div id="divProfile"><table id="tblReport"><tr><td>
  <div id="divProfile_Present">
    <table class="reportTable">
      <tr><td>Sl.No.</td><td>Course</td><td>Faculty</td><td>Held</td><td>Attend</td><td>%</td></tr>
      ${bodyRows}
      <tr><td colspan="3">TOTAL</td><td>333</td><td>222</td><td>66.67</td></tr>
    </table>
  </div>
</td></tr></table></div>
</form></body></html>`;

export const LOGIN_HTML = `<!DOCTYPE html>
<html><body><form id="form1">
  <input type="hidden" name="__VIEWSTATE" value="abc" />
  <input type="text" id="txtUserId" name="txtUserId" />
  <input type="password" id="txtPassword" name="txtPassword" />
  <input type="hidden" name="cf-turnstile-response" value="" />
  <input type="submit" id="btnLogin" value="LOGIN" />
</form></body></html>`;

export const EXPECTED_TOTAL = { held: 333, attended: 222, percent: 66.67 };
export const EXPECTED_SUBJECT_COUNT = 8;
