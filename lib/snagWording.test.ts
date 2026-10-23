import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { contractorPadEnabled, outstandingHeading, outstandingLine, signoffFormOpen, snagConfirmation } from './snagWording.ts';

const CONTRACTOR = 'I confirm the snags listed above have been put right to my satisfaction, on behalf of Northbuild.';
const INTERNAL =
  "I've checked the snags listed above and I'm satisfied they've been put right. This is an internal check for Northbuild, not sign-off by the main contractor.";

test('the sign-off sentence names the typed company', () => {
  assert.equal(snagConfirmation('Northbuild', 'contractor'), CONTRACTOR);
  assert.equal(snagConfirmation('  Northbuild  ', 'internal'), INTERNAL);
  assert.equal(
    snagConfirmation('', 'contractor'),
    'I confirm the snags listed above have been put right to my satisfaction, on behalf of your company.'
  );
  assert.equal(snagConfirmation('', 'contractor').includes('Ashfield'), false);
  assert.equal(snagConfirmation('Ashfield Finishes', 'internal').includes('Ashfield Finishes'), true);
  assert.equal(contractorPadEnabled(''), false);
  assert.equal(contractorPadEnabled('  '), false);
  assert.equal(contractorPadEnabled('Ashfield Finishes'), true);
  assert.equal(signoffFormOpen({ savedOnPhone: false, signedOff: false }), true);
  assert.equal(signoffFormOpen({ savedOnPhone: true, signedOff: false }), false);
  assert.equal(signoffFormOpen({ savedOnPhone: false, signedOff: true }), false);
  assert.equal(outstandingHeading(0), 'No snags are outstanding.');
  assert.equal(outstandingHeading(2), 'Outstanding (not signed off): 2');
  assert.equal(outstandingLine(4, 'Socket box proud of the board', 'Second'), 'S-4 · Socket box proud of the board · Second');
  assert.equal(outstandingLine(1, 'Bead missing', null), 'S-1 · Bead missing');
});

test('an offline save closes the form so the sign-off button cannot be tapped again', () => {
  assert.equal(signoffFormOpen({ savedOnPhone: true, signedOff: false }), false);
  const screen = fs.readFileSync('app/(app)/sites/[siteId]/snags/sign.tsx', 'utf8');
  assert.equal(screen.match(/if \(!signoffFormOpen\(/g)?.length, 2);
  assert.match(screen, /formOpen \? \([\s\S]*Sign internal check[\s\S]*Sign off snags put right/);
  assert.equal(screen.match(/setSavedOnPhone\(true\);\s*clearSignFields\(\);/g)?.length, 2);
  assert.match(screen, /nativeID="saved-on-phone"/);
  const savedAt = screen.indexOf('nativeID="saved-on-phone"');
  const buttonsAt = screen.indexOf('Sign internal check');
  assert.ok(savedAt > 0 && buttonsAt > savedAt);
});

test('the server stores the same sentence the screen shows', () => {
  const sql = fs.readFileSync('supabase/migrations/20261022170000_snags.sql', 'utf8');
  const screen = fs.readFileSync('app/(app)/sites/[siteId]/snags/sign.tsx', 'utf8');
  const pdf = fs.readFileSync('lib/snagPdf.ts', 'utf8');
  const wording = fs.readFileSync('lib/snagWording.ts', 'utf8');
  assert.match(sql, /I confirm the snags listed above have been put right to my satisfaction, on behalf of /);
  assert.match(
    sql,
    /I''ve checked the snags listed above and I''m satisfied they''ve been put right\. This is an internal check for /
  );
  assert.match(sql, /, not sign-off by the main contractor\./);
  assert.match(wording, /I confirm the snags listed above have been put right to my satisfaction, on behalf of \[Company\]\./);
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
  assert.doesNotMatch(screen, /I confirm the snags listed above/);
  assert.match(screen, /Sign off snags put right/);
  assert.match(screen, /Sign internal check/);
  assert.match(screen, /formOpen \? \([\s\S]*Sign internal check[\s\S]*Sign off snags put right/);
  assert.match(screen, /if \(!signoffFormOpen\(/);
  assert.match(screen, /setSavedOnPhone\(true\)/);
  assert.match(screen, /clearSignFields\(\)/);
  assert.match(screen, /nativeID="saved-on-phone"/);
  assert.match(screen, />Signed off</);
  assert.match(screen, /queryValue\(params\.signMode\)/);
  assert.match(screen, /setSignature\(null\)/);
  assert.doesNotMatch(screen, /setSignature\(queryValue\(params/);
  const index = fs.readFileSync('app/(app)/sites/[siteId]/snags/index.tsx', 'utf8');
  assert.match(index, /query\.set\('signMode', notice\.signMode\)/);
  assert.match(index, /query\.set\('signerName', notice\.signerName\)/);
  assert.match(index, /query\.set\('signerCompany', notice\.signerCompany\)/);
});
