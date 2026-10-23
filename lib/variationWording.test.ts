import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { formatPounds, variationAmountEditorOpen } from '../data/variations.ts';
import {
  VARIATION_RESIGN_HINT,
  variationConfirmation,
  variationDetailAmount,
  variationHandoverSummary,
  variationListAmount,
  variationLockLine,
  variationOfficeAmountLine,
  variationScreenAmount,
} from './variationWording.ts';

const WITH_AMOUNT = 'I confirm I instructed this extra work on behalf of Northbuild and agree the amount shown.';
const WITHOUT_AMOUNT = 'I confirm I instructed this extra work on behalf of Northbuild. The price is still to be agreed.';

test('a blank company reads as your company until the field has text', () => {
  assert.equal(variationConfirmation('Northbuild', true), WITH_AMOUNT);
  assert.equal(variationConfirmation('  Northbuild  ', false), WITHOUT_AMOUNT);
  assert.equal(
    variationConfirmation('', true),
    'I confirm I instructed this extra work on behalf of your company and agree the amount shown.'
  );
  assert.equal(
    variationConfirmation('   ', false),
    'I confirm I instructed this extra work on behalf of your company. The price is still to be agreed.'
  );
  assert.equal(variationConfirmation('Otherbuild', false).includes('Otherbuild'), true);
  assert.equal(variationConfirmation('Otherbuild', false).includes('agree the amount shown'), false);
  const sql = fs.readFileSync('supabase/migrations/20261022150000_variations.sql', 'utf8');
  assert.doesNotMatch(sql, /your company/);
  assert.match(sql, /on behalf of ' \|\| v_company \|\| ' and agree the amount shown/);
  assert.match(sql, /on behalf of ' \|\| v_company \|\| '\. The price is still to be agreed/);
});

test('the handover summary formats the amount ex VAT and a single photo', () => {
  assert.equal(formatPounds(14550), '£145.50 + VAT');
  assert.equal(
    variationHandoverSummary(7, 'Extra beads', 14550, 2),
    'VO-7 · Extra beads · £145.50 + VAT · 2 photos'
  );
  assert.equal(variationHandoverSummary(7, 'Extra beads', null, 1), 'VO-7 · Extra beads · 1 photo');
  assert.equal(variationHandoverSummary(3, 'Gate', null, 4), 'VO-3 · Gate · 4 photos');
  assert.equal(
    variationLockLine('22 Oct 2026, 11:14pm'),
    'Record locked at signing, 22 Oct 2026, 11:14pm. Any later change creates a new version.'
  );
});

test('a priced sign-off hides the pounds from an operative and marks an unsigned price for a manager', () => {
  assert.equal(
    variationOfficeAmountLine('Ashfield Finishes'),
    'Amount: agreed with the office. Ask Ashfield Finishes for the priced copy.'
  );
  assert.equal(variationOfficeAmountLine('  '), 'Amount: agreed with the office. Ask the office for the priced copy.');
  assert.equal(variationOfficeAmountLine(null), 'Amount: agreed with the office. Ask the office for the priced copy.');
  const stored = variationConfirmation('Northbuild', true);
  const operative = variationScreenAmount({
    seeValue: false,
    companyName: 'Ashfield Finishes',
    status: 'Signed',
    valuePence: null,
    confirmationText: stored,
    shownValuePence: null,
    hasSignature: true,
  });
  assert.equal(operative.line, variationOfficeAmountLine('Ashfield Finishes'));
  assert.equal(operative.hint, null);
  assert.equal(operative.line?.includes('£'), false);
  assert.equal(stored, 'I confirm I instructed this extra work on behalf of Northbuild and agree the amount shown.');
  const draft = variationDetailAmount({
    seeValue: false,
    valuePence: null,
    shownValuePence: null,
    signedWithoutPrice: false,
    signed: false,
    companyName: 'Ashfield Finishes',
  });
  assert.equal(draft.line, null);
  const manager = variationScreenAmount({
    seeValue: true,
    companyName: 'Ashfield Finishes',
    status: 'Signed',
    valuePence: 14550,
    confirmationText: variationConfirmation('Northbuild', false),
    shownValuePence: null,
    hasSignature: true,
  });
  assert.equal(manager.line, 'Amount · £145.50 + VAT, not yet agreed. Signed before a price was set.');
  assert.equal(manager.hint, VARIATION_RESIGN_HINT);
  assert.equal(VARIATION_RESIGN_HINT, 'To get it signed at this price: Edit as new version, then hand over.');
  const list = variationListAmount(
    { status: 'Signed', value_pence: 14550, shown_value_pence: null, signed_without_price: true },
    true
  );
  assert.equal(list, '£145.50 · not agreed');
  assert.equal(list?.includes('+ VAT'), false);
  const agreed = variationScreenAmount({
    seeValue: true,
    companyName: 'Ashfield Finishes',
    status: 'Signed',
    valuePence: 14550,
    confirmationText: stored,
    shownValuePence: 14550,
    hasSignature: true,
  });
  assert.equal(agreed.line, 'Amount · £145.50 + VAT');
  assert.equal(agreed.hint, null);
  assert.equal(agreed.line?.includes('not yet agreed'), false);
  assert.equal(
    variationListAmount(
      { status: 'Signed', value_pence: 14550, shown_value_pence: 14550, signed_without_price: false },
      true
    ),
    '£145.50 + VAT'
  );
  assert.equal(
    variationListAmount(
      { status: 'Signed', value_pence: 14550, shown_value_pence: null, signed_without_price: true },
      false
    ),
    null
  );
});

test('handover hides the amount editor, and the screen and PDF share the wording module', () => {
  assert.equal(variationAmountEditorOpen(false, true, true), false);
  assert.equal(variationAmountEditorOpen(false, true, false), true);
  assert.equal(variationAmountEditorOpen(true, true, false), false);
  assert.equal(variationAmountEditorOpen(false, false, false), false);
  const screen = fs.readFileSync('app/(app)/sites/[siteId]/variations/[variationId].tsx', 'utf8');
  const list = fs.readFileSync('app/(app)/sites/[siteId]/variations/index.tsx', 'utf8');
  const pdf = fs.readFileSync('lib/variationPdf.ts', 'utf8');
  const wording = fs.readFileSync('lib/variationWording.ts', 'utf8');
  assert.match(screen, /variationConfirmation\(/);
  assert.match(screen, /variationScreenAmount\(/);
  assert.match(screen, /variationPdfAmountLine\(/);
  assert.match(screen, /minHeight=\{48\}/);
  assert.match(screen, /minHeight=\{56\}/);
  assert.match(list, /variationListAmount\(/);
  assert.match(list, /minHeight=\{56\}/);
  assert.match(screen, /disabled=\{!signerCompany\.trim\(\)\}/);
  assert.match(screen, /variationHandoverSummary\(/);
  assert.match(screen, /variationAmountEditorOpen\(/);
  assert.match(screen, /label="£ ex VAT"/);
  assert.match(pdf, /variationConfirmation\(/);
  assert.match(pdf, /variationLockLine\(/);
  assert.match(wording, /I confirm I instructed this extra work on behalf of \[Company\] and agree the amount shown\./);
  assert.match(wording, /I confirm I instructed this extra work on behalf of \[Company\]\. The price is still to be agreed\./);
  assert.doesNotMatch(screen, /I confirm I instructed/);
  assert.doesNotMatch(pdf, /I confirm I instructed/);
  assert.doesNotMatch(screen, /Role and company/);
});