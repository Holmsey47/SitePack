import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  contractorPadEnabled,
  outstandingHeading,
  outstandingLine,
  putRightLine,
  rememberSignAgain,
  signAgainPath,
  signoffFormOpen,
  snagConfirmation,
  takeSignAgain,
} from './snagWording.ts';

const CONTRACTOR_ONE =
  'I confirm the 1 snag marked complete above has been put right to my satisfaction, on behalf of Northbuild. Snags listed as outstanding are not signed off.';
const CONTRACTOR_TWO =
  'I confirm the 2 snags marked complete above have been put right to my satisfaction, on behalf of Northbuild. Snags listed as outstanding are not signed off.';
const INTERNAL_ONE =
  "I've checked the 1 snag marked complete above and I'm satisfied it's been put right. This is an internal check for Ashfield Finishes, not sign-off by the main contractor.";
const INTERNAL_TWO =
  "I've checked the 2 snags marked complete above and I'm satisfied they've been put right. This is an internal check for Northbuild, not sign-off by the main contractor.";

test('the sign-off sentence names the snapshot count and the typed company', () => {
  assert.equal(snagConfirmation('Northbuild', 'contractor', 1), CONTRACTOR_ONE);
  assert.equal(snagConfirmation('Northbuild', 'contractor', 2), CONTRACTOR_TWO);
  assert.equal(snagConfirmation('  Northbuild  ', 'internal', 2), INTERNAL_TWO);
  assert.equal(snagConfirmation('Ashfield Finishes', 'internal', 1), INTERNAL_ONE);
  assert.equal(
    snagConfirmation('', 'contractor', 1),
    'I confirm the 1 snag marked complete above has been put right to my satisfaction, on behalf of your company. Snags listed as outstanding are not signed off.'
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
  assert.equal(
    snagConfirmation('$& $1', 'contractor', 1),
    'I confirm the 1 snag marked complete above has been put right to my satisfaction, on behalf of $& $1. Snags listed as outstanding are not signed off.'
  );
  assert.equal(
    snagConfirmation('$& $1', 'internal', 2),
    "I've checked the 2 snags marked complete above and I'm satisfied they've been put right. This is an internal check for $& $1, not sign-off by the main contractor."
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
  assert.equal(putRightLine([]), 'No snags are marked put right yet.');
  assert.equal(
    putRightLine([
      { snagSeq: 5, note: 'Door closer' },
      { snagSeq: 6, note: 'Skirting' },
    ]),
    '2 put right: S-5 Door closer, S-6 Skirting'
  );
  const long = putRightLine(
    Array.from({ length: 8 }, (_, index) => ({ snagSeq: index + 1, note: 'Door closer missing from the frame' }))
  );
  assert.equal(long.startsWith('8 put right: S-1 Door closer'), true);
  assert.equal(long.endsWith('\u2026'), true);
  assert.ok(Array.from(long).length <= 96);
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
  assert.match(sql, /I confirm the 1 snag marked complete above has been put right to my satisfaction, on behalf of \[Company\]\. Snags listed as outstanding are not signed off\./);
  assert.match(sql, /I confirm the ' \|\| p_count::text \|\| ' snags marked complete above have been put right to my satisfaction, on behalf of \[Company\]\. Snags listed as outstanding are not signed off\./);
  assert.match(sql, /I''ve checked the 1 snag marked complete above and I''m satisfied it''s been put right\. This is an internal check for \[Company\], not sign-off by the main contractor\./);
  assert.match(
    sql,
    /I''ve checked the ' \|\| p_count::text \|\| ' snags marked complete above and I''m satisfied they''ve been put right\. This is an internal check for \[Company\], not sign-off by the main contractor\./
  );
  assert.match(sql, /return replace\(v_sentence, '\[Company\]', v_company\);/);
  assert.doesNotMatch(sql, /regexp_replace/);
  assert.match(sql, /coalesce\(array_length\(v_fixed_ids, 1\), 0\)/);
  assert.match(wording, /I confirm the 1 snag marked complete above has been put right to my satisfaction, on behalf of \[Company\]\. Snags listed as outstanding are not signed off\./);
  assert.match(wording, /I confirm the \[n\] snags marked complete above have been put right to my satisfaction, on behalf of \[Company\]\. Snags listed as outstanding are not signed off\./);
  assert.match(wording, /\.replace\('\[Company\]', \(\) => shown\)/);
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
  assert.match(screen, /Not signed off/);
  assert.match(screen, /putRightLine\(/);
  assert.ok(screen.indexOf('nativeID="put-right-list"') < screen.indexOf('{shownSign.confirmation}'));
  const form = screen.slice(screen.indexOf('formOpen ?'));
  assert.ok(form.indexOf('nativeID="put-right-list"') < form.indexOf('snagConfirmation(internalCompany'));
  assert.ok(form.indexOf('snagConfirmation(contractorCompany') < form.indexOf('<SignaturePad'));
  assert.match(screen, /takeSignAgain\(\)/);
  assert.match(screen, /setSignature\(null\)/);
  assert.doesNotMatch(screen, /params\.signerName|params\.signerRole|params\.signerCompany/);
  const index = fs.readFileSync('app/(app)/sites/[siteId]/snags/index.tsx', 'utf8');
  assert.match(index, /rememberSignAgain\(/);
  assert.match(index, /router\.push\(`\/sites\/\$\{siteId\}\/snags\/sign`\)/);
  assert.doesNotMatch(index, /query\.set\('signerName'|query\.set\('signerRole'|query\.set\('signerCompany'/);
  assert.doesNotMatch(index, /snags\/sign\?/);
});

test('sign again keeps name, role and company off the route', () => {
  const route = signAgainPath('66666666-6666-6666-6666-666666666666');
  const params = new URL(route, 'https://sitepack.test').searchParams;
  assert.equal(route.includes('?'), false);
  assert.equal(params.has('signerName'), false);
  assert.equal(params.has('signerRole'), false);
  assert.equal(params.has('signerCompany'), false);
  assert.equal(params.has('name'), false);
  assert.equal(params.has('role'), false);
  assert.equal(params.has('company'), false);
  rememberSignAgain({
    signMode: 'contractor',
    signerName: 'Dave Moran',
    signerRole: 'Site manager',
    signerCompany: 'Northbuild',
  });
  const draft = takeSignAgain();
  assert.equal(draft?.signMode, 'contractor');
  assert.equal(draft?.signerName, 'Dave Moran');
  assert.equal(draft?.signerRole, 'Site manager');
  assert.equal(draft?.signerCompany, 'Northbuild');
  assert.equal(takeSignAgain(), null);
  const screen = fs.readFileSync('app/(app)/sites/[siteId]/snags/sign.tsx', 'utf8');
  const index = fs.readFileSync('app/(app)/sites/[siteId]/snags/index.tsx', 'utf8');
  assert.doesNotMatch(screen, /signerName\?:/);
  assert.doesNotMatch(screen, /signerRole\?:/);
  assert.doesNotMatch(screen, /signerCompany\?:/);
  assert.doesNotMatch(index, /URLSearchParams/);
});
