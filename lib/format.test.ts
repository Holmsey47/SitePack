import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { contrastRatio } from './contrast.ts';
import { drawingFooterLine, formatCodeExpiry, formatSheetDay, formatSignedWhen } from './format.ts';
import { theme } from './theme.ts';

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

test('a drawing footer is one London line without the year', () => {
  assert.equal(formatSheetDay('2026-10-01'), '1 Oct');
  assert.equal(
    drawingFooterLine({ current: true, day: '1 Oct', level: 'Ground', seen: '0 of 2 seen' }),
    'Current · 1 Oct · Ground · 0 of 2 seen',
  );
  assert.equal(drawingFooterLine({ current: false, day: '1 Oct' }), 'Superseded · 1 Oct');
  assert.equal(drawingFooterLine({ current: null, stale: true }), 'Out of date · On this phone');
  const drawing = fs.readFileSync('app/(app)/sites/[siteId]/drawing/[drawingId].tsx', 'utf8');
  assert.match(drawing, /drawingFooterLine/);
  assert.doesNotMatch(drawing, /Phone online/);
  assert.doesNotMatch(fs.readFileSync('components/phone-status.tsx', 'utf8'), /Phone online/);
  assert.doesNotMatch(fs.readFileSync('components/fixture-offline.tsx', 'utf8'), /Phone online/);
});

test('a signature time is London wall time without the year', () => {
  assert.equal(formatSignedWhen('2026-10-27T22:08:00.000Z'), '27 Oct, 10:08pm');
  assert.equal(formatSignedWhen('2026-10-22T21:08:00.000Z'), '22 Oct, 10:08pm');
  assert.equal(formatSignedWhen(''), '');
});

test('the share panel and the invite offer use the same expiry helper', () => {
  const panel = fs.readFileSync(new URL('../components/JoinSharePanel.tsx', import.meta.url), 'utf8');
  const offer = fs.readFileSync(new URL('../components/JoinCodeOffer.tsx', import.meta.url), 'utf8');
  const cache = fs.readFileSync(new URL('./joinCodeCache.ts', import.meta.url), 'utf8');
  assert.match(panel, /formatCodeExpiry\(expiresAt\)/);
  assert.match(cache, /formatCodeExpiry\(expiresAt/);
  assert.match(offer, /activeCodeNotice\(/);
  assert.match(offer, /uses=\{visible\.row\.uses\}/);
  assert.match(panel, /\{uses\} of \{maxUses\} joined/);
  assert.match(offer, /label="Regenerate"/);
  assert.doesNotMatch(panel, /formatDate\(expiresAt\)/);
  assert.doesNotMatch(offer, /formatDate\(/);
});

test('a superseded sheet says not to build from it, in readable ink', () => {
  const ui = fs.readFileSync(new URL('../components/ui.tsx', import.meta.url), 'utf8');
  const folder = fs.readFileSync(new URL('../app/(app)/sites/[siteId]/folder/[folder].tsx', import.meta.url), 'utf8');
  const viewer = fs.readFileSync(new URL('../app/(app)/sites/[siteId]/drawing/[drawingId].tsx', import.meta.url), 'utf8');
  assert.match(ui, /SUPERSEDED_DO_NOT_BUILD = 'SUPERSEDED, do not build from'/);
  assert.match(ui, /backgroundColor: theme\.danger/);
  assert.match(ui, /color: theme\.currentInk/);
  assert.ok(contrastRatio(theme.currentInk, theme.danger) >= 4.5);
  assert.match(folder, /<SupersededSafetyLabel \/>/);
  assert.match(folder, /Old revisions hidden\. Tap All to see them\./);
  assert.match(folder, /Show superseded \/ archive/);
  assert.match(viewer, /<SupersededSafetyLabel \/>/);
});
