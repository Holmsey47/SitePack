import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { formatCodeExpiry } from './format.ts';

test('a code expiry names today, tomorrow, or a later London day, and a past time is Ended', () => {
  const now = '2026-10-22T12:00:00.000Z';
  assert.equal(formatCodeExpiry('2026-10-22T17:30:00.000Z', now), 'Ends today 6:30pm');
  assert.equal(formatCodeExpiry('2026-10-23T06:05:00.000Z', now), 'Ends tomorrow 7:05am');
  assert.equal(formatCodeExpiry('2026-10-24T17:30:00.000Z', now), 'Ends Sat 24 Oct, 6:30pm');
  assert.equal(formatCodeExpiry('2026-10-22T11:59:00.000Z', now), 'Ended');
  assert.equal(formatCodeExpiry(now, now), 'Ended');
  assert.equal(formatCodeExpiry('2026-10-22T11:00:00.000Z', '2026-10-22T08:00:00.000Z'), 'Ends today 12:00pm');
  assert.equal(formatCodeExpiry('2026-10-22T23:00:00.000Z', '2026-10-22T20:00:00.000Z'), 'Ends tomorrow 12:00am');
});

test('midnight is judged on the London calendar, not UTC', () => {
  const beforeMidnight = '2026-10-22T22:30:00.000Z';
  assert.equal(formatCodeExpiry('2026-10-22T23:30:00.000Z', beforeMidnight), 'Ends tomorrow 12:30am');

  const afterMidnight = '2026-10-22T23:30:00.000Z';
  assert.equal(formatCodeExpiry('2026-10-23T17:30:00.000Z', afterMidnight), 'Ends today 6:30pm');
  assert.equal(formatCodeExpiry('2026-10-22T21:00:00.000Z', afterMidnight), 'Ended');
  assert.equal(formatCodeExpiry('2026-10-24T17:30:00.000Z', afterMidnight), 'Ends tomorrow 6:30pm');
  assert.equal(formatCodeExpiry('2026-10-25T17:30:00.000Z', afterMidnight), 'Ends Sun 25 Oct, 5:30pm');
});

test('the BST to GMT change on 25 Oct 2026 01:00 UTC stays on the London day', () => {
  const change = '2026-10-25T01:00:00.000Z';
  assert.equal(formatCodeExpiry('2026-10-25T18:30:00.000Z', change), 'Ends today 6:30pm');
  assert.equal(formatCodeExpiry('2026-10-26T07:05:00.000Z', change), 'Ends tomorrow 7:05am');
  assert.equal(formatCodeExpiry('2026-10-30T17:30:00.000Z', change), 'Ends Fri 30 Oct, 5:30pm');
  assert.equal(formatCodeExpiry('2026-10-25T00:30:00.000Z', change), 'Ended');

  const beforeFallback = '2026-10-25T00:30:00.000Z';
  assert.equal(formatCodeExpiry('2026-10-25T01:30:00.000Z', beforeFallback), 'Ends today 1:30am');
  assert.equal(formatCodeExpiry('2026-10-25T23:30:00.000Z', change), 'Ends today 11:30pm');
});

test('the share panel and the active code list use the same expiry helper', () => {
  const panel = fs.readFileSync(new URL('../components/JoinSharePanel.tsx', import.meta.url), 'utf8');
  const invite = fs.readFileSync(new URL('../app/(app)/sites/[siteId]/invite-code.tsx', import.meta.url), 'utf8');
  assert.match(panel, /formatCodeExpiry\(expiresAt\)/);
  assert.match(invite, /formatCodeExpiry\(row\.expires_at\)/);
  assert.match(panel, /uses > 0/);
  assert.match(invite, /row\.uses > 0/);
  assert.match(invite, /Share again/);
  assert.doesNotMatch(panel, /formatDate\(expiresAt\)/);
  assert.doesNotMatch(invite, /formatDate\(row\.expires_at\)/);
});
