import test from 'node:test';
import assert from 'node:assert/strict';

import { extractCookieHeader } from './cookieInput.js';

test('a bare, already-correct cookie header round-trips unchanged', () => {
  const input = 'ASP.NET_SessionId=abc123; AuthToken=def456; frmAuth=GHI789';
  assert.equal(extractCookieHeader(input), input);
});

test('pulls the cookie: line out of a full Request Headers block', () => {
  const input = [
    ':authority: info.aec.edu.in',
    ':method: GET',
    'accept: text/html,application/xhtml+xml',
    'accept-language: en-US,en;q=0.9',
    'cookie: ASP.NET_SessionId=abc123; AuthToken=def456; frmAuth=GHI789',
    'referer: https://info.aec.edu.in/aus/StudentMaster.aspx',
    'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  ].join('\n');

  assert.equal(
    extractCookieHeader(input),
    'ASP.NET_SessionId=abc123; AuthToken=def456; frmAuth=GHI789'
  );
});

test('is case-insensitive about the cookie: label', () => {
  const input = 'Cookie: ASP.NET_SessionId=abc123';
  assert.equal(extractCookieHeader(input), 'ASP.NET_SessionId=abc123');
});

test('parses a DevTools Application > Cookies table paste (tab-separated)', () => {
  const input = [
    'Name\tValue\tDomain\tPath\tExpires / Max-Age\tSize\tHttpOnly\tSecure\tSameSite',
    'ASP.NET_SessionId\tabc123\tinfo.aec.edu.in\t/\tSession\t30\tYes\tYes\tLax',
    'AuthToken\tdef456\tinfo.aec.edu.in\t/\tSession\t40\tYes\tYes\tLax',
    'frmAuth\tGHI789\tinfo.aec.edu.in\t/\tSession\t400\tYes\tYes\tLax',
  ].join('\n');

  assert.equal(
    extractCookieHeader(input),
    'ASP.NET_SessionId=abc123; AuthToken=def456; frmAuth=GHI789'
  );
});

test('tolerates a table paste with no header row', () => {
  const input = ['ASP.NET_SessionId\tabc123\tinfo.aec.edu.in', 'AuthToken\tdef456\tinfo.aec.edu.in'].join(
    '\n'
  );
  assert.equal(extractCookieHeader(input), 'ASP.NET_SessionId=abc123; AuthToken=def456');
});

test('tolerates extra whitespace and blank lines', () => {
  const input = '\n\n  ASP.NET_SessionId = abc123 ;  AuthToken = def456  \n\n';
  assert.equal(extractCookieHeader(input), 'ASP.NET_SessionId=abc123; AuthToken=def456');
});

test('drops duplicate names, keeping the first', () => {
  const input = 'ASP.NET_SessionId=abc123; ASP.NET_SessionId=stale';
  assert.equal(extractCookieHeader(input), 'ASP.NET_SessionId=abc123');
});

test('ignores a value that looks like a URL rather than a cookie', () => {
  const input = 'redirect=https://example.com/foo';
  assert.equal(extractCookieHeader(input), null);
});

test('returns null for input with nothing cookie-shaped', () => {
  assert.equal(extractCookieHeader('hey what does this button do'), null);
  assert.equal(extractCookieHeader(''), null);
  assert.equal(extractCookieHeader('   '), null);
  assert.equal(extractCookieHeader(undefined), null);
});

test('caps pathologically long input rather than hanging', () => {
  const huge = 'a'.repeat(1_000_000) + '; ASP.NET_SessionId=abc123';
  // Value at the very end, past the cap, so it's expected to be missed — the
  // point is just that this returns quickly instead of blowing up.
  const start = Date.now();
  extractCookieHeader(huge);
  assert.ok(Date.now() - start < 500);
});
