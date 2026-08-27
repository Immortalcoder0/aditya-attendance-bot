import { screenshotHtml } from '../portal/render.js';

/**
 * Renders a per-subject attendance bar chart as a PNG.
 *
 * Built as plain self-contained HTML/CSS and screenshotted through the same
 * real-Chrome instance render.js already uses for portal data — no charting
 * library, no new dependency, no image-generation native bindings that could
 * complicate the Docker build.
 */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function cleanName(name) {
  return String(name ?? '').replace(/\s*\(minor Stream\)\s*/i, '');
}

function colorFor(ratio, target) {
  if (ratio >= target + 0.1) return '#22c55e';
  if (ratio >= target) return '#eab308';
  return '#ef4444';
}

function barRow({ name, ratio, target }) {
  const percent = Math.round(ratio * 1000) / 10;
  const width = Math.min(100, Math.max(0, percent));
  const targetPercent = Math.min(100, Math.max(0, target * 100));
  return `
    <div class="row">
      <div class="label">${escapeHtml(cleanName(name))}</div>
      <div class="track">
        <div class="fill" style="width:${width}%;background:${colorFor(ratio, target)}"></div>
        <div class="target" style="left:${targetPercent}%"></div>
      </div>
      <div class="value">${percent.toFixed(1)}%</div>
    </div>`;
}

function buildHtml(attendance, target) {
  const rows = attendance.subjects
    .map((s) => barRow({ name: s.name, ratio: s.held > 0 ? s.attended / s.held : 0, target }))
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 32px;
    background: #0f172a; color: #e2e8f0;
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { font-size: 13px; color: #94a3b8; margin: 0 0 22px; }
  .row { display: flex; align-items: center; margin-bottom: 16px; }
  .label {
    width: 300px; font-size: 14px; padding-right: 14px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .track {
    flex: 1; height: 22px; background: #1e293b; border-radius: 5px;
    position: relative; overflow: hidden;
  }
  .fill { height: 100%; border-radius: 5px; }
  .target { position: absolute; top: -3px; bottom: -3px; width: 2px; background: #f8fafc; }
  .value { width: 64px; text-align: right; font-size: 14px; padding-left: 12px; font-variant-numeric: tabular-nums; }
</style></head>
<body>
  <h1>Subject-wise attendance</h1>
  <div class="sub">Target ${(target * 100).toFixed(0)}% · white line marks the target</div>
  ${rows}
</body></html>`;
}

/** @returns {Promise<Buffer>} PNG image bytes */
export async function renderAttendanceChart(attendance, target) {
  const html = buildHtml(attendance, target);
  const height = 110 + attendance.subjects.length * 46;
  return screenshotHtml(html, { width: 900, height });
}
