import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { contractorPadEnabled, outstandingHeading, outstandingLine, snagConfirmation } from './snagWording.ts';

const CONTRACTOR = 'I confirm the snags marked complete below have been put right to my satisfaction, on behalf of Northbuild.';
const INTERNAL =
  "I've checked the snags marked complete below and I'm satisfied they've been put right. This is an internal check for Northbuild, not sign-off by the main contractor.";

test('the sign-off sentence names the typed company', () => {
  assert.equal(snagConfirmation('Northbuild', 'contractor'), CONTRACTOR);
  assert.equal(snagConfirmation('  Northbuild  ', 'internal'), INTERNAL);
  assert.equal(
    snagConfirmation('', 'contractor'),
    'I confirm the snags marked complete below have been put right to my satisfaction, on behalf of your company.'
  );
  assert.equal(snagConfirmation('', 'contractor').includes('Ashfield'), false);
  assert.equal(snagConfirmation('Ashfield Finishes', 'internal').includes('Ashfield Finishes'), true);
  assert.equal(contractorPadEnabled(''), false);
  assert.equal(contractorPadEnabled('  '), false);
  assert.equal(contractorPadEnabled('Ashfield Finishes'), true);
  assert.equal(outstandingHeading(0), 'No snags are outstanding.');
  assert.equal(outstandingHeading(2), 'Outstanding (not signed off): 2');
  assert.equal(outstandingLine(4, 'Socket box proud of the board', 'Second'), 'S-4 · Socket box proud of the board · Second');
  assert.equal(outstandingLine(1, 'Bead missing', null), 'S-1 · Bead missing');
});

test('the server stores the same sentence the screen shows', () => {
  const sql = fs.readFileSync('supabase/migrations/20261022170000_snags.sql', 'utf8');
  const screen = fs.readFileSync('app/(app)/sites/[siteId]/snags/sign.tsx', 'utf8');
  const pdf = fs.readFileSync('lib/snagPdf.ts', 'utf8');
  const wording = fs.readFileSync('lib/snagWording.ts', 'utf8');
  assert.match(sql, /I confirm the snags marked complete below have been put right to my satisfaction, on behalf of /);
  assert.match(
    sql,
    /I''ve checked the snags marked complete below and I''m satisfied they''ve been put right\. This is an internal check for /
  );
  assert.match(sql, /, not sign-off by the main contractor\./);
  assert.match(wording, /I confirm the snags marked complete below have been put right to my satisfaction, on behalf of \[Company\]\./);
  assert.doesNotMatch(sql, /your company/);
  assert.match(screen, /snagConfirmation\(internalCompany, 'internal'\)/);
  assert.match(screen, /snagConfirmation\(contractorCompany, 'contractor'\)/);
  assert.match(screen, /Main contractor company/);
  assert.match(screen, /disabled=\{!contractorPadEnabled\(contractorCompany\)\}/);
  assert.match(screen, /outstandingHeading\(/);
  const signerAt = screen.indexOf('nativeID="signer-block"');
  const outstandingAt = screen.indexOf('nativeID="outstanding-snags"');
  assert.ok(signerAt > 0 && outstandingAt > signerAt);
  assert.match(pdf, /SNAG_SIGN_OFF_DISCLAIMER/);
  assert.match(pdf, /Internal check/);
  assert.doesNotMatch(pdf, /snagConfirmation\(/);
  assert.doesNotMatch(screen, /I confirm the snags marked complete below/);
  assert.match(screen, /Sign off snags put right/);
});
