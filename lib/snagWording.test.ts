import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { contractorPadEnabled, outstandingHeading, outstandingLine, signoffFormOpen, snagConfirmation } from './snagWording.ts';

const CONTRACTOR_ONE =
  'I confirm the 1 snag marked complete above have been put right to my satisfaction, on behalf of Northbuild. Snags listed as outstanding are not signed off.';
const CONTRACTOR_TWO =
  'I confirm the 2 snags marked complete above have been put right to my satisfaction, on behalf of Northbuild. Snags listed as outstanding are not signed off.';
const INTERNAL_ONE =
  "I've checked the 1 snag marked complete above and I'm satisfied they've been put right. This is an internal check for Ashfield Finishes, not sign-off by the main contractor.";
const INTERNAL_TWO =
  "I've checked the 2 snags marked complete above and I'm satisfied they've been put right. This is an internal check for Northbuild, not sign-off by the main contractor.";

test('the sign-off sentence names the snapshot count and the typed company', () => {
  assert.equal(snagConfirmation('Northbuild', 'contractor', 1), CONTRACTOR_ONE);
  assert.equal(snagConfirmation('Northbuild', 'contractor', 2), CONTRACTOR_TWO);
  assert.equal(snagConfirmation('  Northbuild  ', 'internal', 2), INTERNAL_TWO);
  assert.equal(snagConfirmation('Ashfield Finishes', 'internal', 1), INTERNAL_ONE);
  assert.equal(
    snagConfirmation('', 'contractor', 1),
    'I confirm the 1 snag marked complete above have been put right to my satisfaction, on behalf of your company. Snags listed as outstanding are not signed off.'
  );
  assert.equal(
    snagConfirmation('   ', 'internal', 3),
    "I've checked the 3 snags marked complete above and I'm satisfied they've been put right. This is an internal check for your company, not sign-off by the main contractor."
  );
  assert.equal(snagConfirmation('North £build', 'contractor', 2).includes('£'), false);
  assert.equal(
    snagConfirmation('North £build', 'contractor', 2),
    'I confirm the 2 snags marked complete above have been put right to my satisfaction, on behalf of North build. Snags listed as outstanding are not signed off.'
  );
  for (const sentence of [CONTRACTOR_ONE, CONTRACTOR_TWO, INTERNAL_ONE, INTERNAL_TWO]) {
    assert.equal(sentence.includes('£'), false);
  }
  assert.equal(snagConfirmation('', 'contractor', 1).includes('Ashfield'), false);
  assert.equal(snagConfirmation('Ashfield Finishes', 'internal', 1).includes('Ashfield Finishes'), true);
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
  assert.match(sql, /v_noun := case when p_count = 1 then 'snag' else 'snags' end;/);
  assert.match(sql, /I confirm the ' \|\| p_count::text \|\| ' ' \|\| v_noun \|\| ' marked complete above have been put right to my satisfaction, on behalf of /);
  assert.match(sql, /Snags listed as outstanding are not signed off\./);
  assert.match(
    sql,
    /I''ve checked the ' \|\| p_count::text \|\| ' ' \|\| v_noun \|\| ' marked complete above and I''m satisfied they''ve been put right\. This is an internal check for /
  );
  assert.match(sql, /, not sign-off by the main contractor\./);
  assert.match(sql, /coalesce\(array_length\(v_fixed_ids, 1\), 0\)/);
  assert.match(wording, /I confirm the \[n\] snags marked complete above have been put right to my satisfaction, on behalf of \[Company\]\. Snags listed as outstanding are not signed off\./);
  assert.doesNotMatch(sql, /your company/);
  assert.match(sql, /replace\(coalesce\(p_company, ''\), '£', ''\)/);
  assert.match(screen, /snagConfirmation\(internalCompany, 'internal', shownCovered\.length\)/);
  assert.match(screen, /snagConfirmation\(contractorCompany, 'contractor', shownCovered\.length\)/);
  assert.match(screen, /snagConfirmation\(internalCompany, 'internal', fixed\.length\)/);
  assert.match(screen, /snagConfirmation\(contractorCompany, 'contractor', fixed\.length\)/);
  assert.match(screen, /Main contractor company/);
  assert.match(screen, /disabled=\{!contractorPadEnabled\(contractorCompany\)\}/);
  assert.match(screen, /outstandingHeading\(/);
  const signerAt = screen.indexOf('nativeID="signer-block"');
  const outstandingAt = screen.indexOf('nativeID="outstanding-snags"');
  assert.ok(signerAt > 0 && outstandingAt > signerAt);
  assert.match(pdf, /SNAG_SIGN_OFF_DISCLAIMER/);
  assert.match(pdf, /Internal check/);
  assert.doesNotMatch(pdf, /snagConfirmation\(/);
  assert.doesNotMatch(screen, /marked complete above/);
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
