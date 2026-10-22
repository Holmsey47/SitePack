import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { formatPounds, variationAmountEditorOpen } from '../data/variations.ts';
import { variationConfirmation, variationHandoverSummary, variationLockLine } from './variationWording.ts';

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

test('handover hides the amount editor, and the screen and PDF share the wording module', () => {
  assert.equal(variationAmountEditorOpen(false, true, true), false);
  assert.equal(variationAmountEditorOpen(false, true, false), true);
  assert.equal(variationAmountEditorOpen(true, true, false), false);
  assert.equal(variationAmountEditorOpen(false, false, false), false);
  const screen = fs.readFileSync('app/(app)/sites/[siteId]/variations/[variationId].tsx', 'utf8');
  const pdf = fs.readFileSync('lib/variationPdf.ts', 'utf8');
  const wording = fs.readFileSync('lib/variationWording.ts', 'utf8');
  assert.match(screen, /variationConfirmation\(/);
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