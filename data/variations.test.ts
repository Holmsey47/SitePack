import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import {
  canSeeVariationValue,
  filterVariations,
  formatPounds,
  OPERATIVES_SEE_VARIATION_VALUE,
  parsePounds,
  variationCounts,
  variationPdfFilename,
} from './variations.ts';
import { formatUkDateTime } from '../lib/format.ts';
import { variationConfirmation, variationListAmount, variationScreenAmount } from '../lib/variationWording.ts';

test('pounds parse and the UK clock', () => {
  assert.equal(parsePounds(''), null);
  assert.equal(parsePounds('£12.50'), 1250);
  assert.equal(parsePounds('1,250.5'), 125050);
  assert.equal(formatPounds(18000), '£180.00 + VAT');
  assert.equal(formatPounds(14550), '£145.50 + VAT');
  assert.equal(formatUkDateTime('2026-10-22T13:05:00.000Z'), '22 Oct 2026, 2:05pm');
  assert.equal(variationPdfFilename(4), 'Variation VO-4.pdf');
  assert.throws(() => parsePounds('12.5p/hour'), /invalid_input/);
});

test('counts stay on the whole list when the status filter changes', () => {
  const rows = [
    { variation_id: '1', version_id: 'a', vo_seq: 1, version_no: 1, title: 'A', status: 'Draft' as const, photo_count: 1, value_pence: null, created_at: '' },
    { variation_id: '2', version_id: 'b', vo_seq: 2, version_no: 1, title: 'B', status: 'Signed' as const, photo_count: 1, value_pence: null, created_at: '' },
    { variation_id: '3', version_id: 'c', vo_seq: 3, version_no: 1, title: 'C', status: 'Sent' as const, photo_count: 1, value_pence: null, created_at: '' },
  ];
  assert.deepEqual(variationCounts(rows), { open: 1, signed: 2 });
  assert.equal(filterVariations(rows, 'Signed').length, 1);
  assert.equal(filterVariations(rows, 'All').length, 3);
});

test('an operative cannot set the amount, another site stays hidden, and a signature locks the row', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const oak = await fixtureRepo.listVariations(IDS.oak);
  assert.equal(oak.open_count, 1);
  assert.equal(oak.signed_count, 2);
  await assert.rejects(() => fixtureRepo.listVariations(IDS.warehouse), /not_authorized/);
  await assert.rejects(
    () =>
      fixtureRepo.createVariation({
        siteId: IDS.oak,
        title: 'Extra',
        description: 'Note',
        photos: [{ storagePath: 'x', contentType: 'image/jpeg', fileSizeBytes: 10 }],
        valuePence: 100,
      }),
    /value_not_allowed/
  );

  const draft = oak.rows.find((row) => row.status === 'Draft');
  assert.ok(draft);
  const before = await fixtureRepo.getVariation(draft.variation_id);
  assert.equal(before?.current.status, 'Draft');
  await fixtureRepo.signVariation(draft.version_id, {
    signerName: 'Dave Moran',
    role: 'Site manager',
    company: 'Northbuild',
    expectedPence: null,
    signaturePng: 'data:image/png;base64,' + 'A'.repeat(40),
  });
  await assert.rejects(
    () => fixtureRepo.setVariationValue(draft.version_id, 50),
    /value_not_allowed|variation_locked/
  );
  const locked = await fixtureRepo.getVariation(draft.variation_id);
  assert.equal(locked?.current.status, 'Signed');
  assert.equal(locked?.current.signature?.signer_name, 'Dave Moran');
  assert.equal(locked?.current.signature?.signer_role, 'Site manager');
  assert.equal(locked?.current.signature?.signer_company, 'Northbuild');
  assert.equal(locked?.current.signature?.confirmation_text, variationConfirmation('Northbuild', false));
  assert.equal(locked?.current.signature?.shown_value_pence, null);
  await assert.rejects(() => fixtureRepo.reviseVariation(draft.version_id), /not_authorized/);
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const revised = await fixtureRepo.reviseVariation(draft.version_id);
  const after = await fixtureRepo.getVariation(draft.variation_id);
  assert.equal(after?.current.version_id, revised.versionId);
  assert.equal(after?.current.status, 'Draft');
  assert.equal(after?.current.value_pence, null);
  assert.equal(after?.history[0]?.status, 'Signed');
  assert.equal(after?.history[0]?.signature?.signer_name, 'Dave Moran');
  assert.equal(after?.history[0]?.title, before?.current.title);
});

test('an operative read hides the pound amount and a mismatched sign-off is rejected', async () => {
  assert.equal(OPERATIVES_SEE_VARIATION_VALUE, false);
  assert.equal(canSeeVariationValue('operative'), false);
  assert.equal(canSeeVariationValue('owner'), true);
  assert.equal(canSeeVariationValue('cm'), true);

  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const oak = await fixtureRepo.listVariations(IDS.oak);
  const mastic = oak.rows.find((row) => row.title === 'Additional mastic');
  assert.ok(mastic);
  assert.equal(mastic.value_pence, null);
  const hidden = await fixtureRepo.getVariation(mastic.variation_id);
  assert.equal(hidden?.current.value_pence, null);
  assert.equal(hidden?.current.signature?.shown_value_pence, null);
  assert.equal(hidden?.current.signature?.confirmation_text, variationConfirmation('Northbuild', true));
  assert.equal(mastic.signed_without_price, false);
  assert.equal(mastic.shown_value_pence, null);
  const operativePriced = variationScreenAmount({
    seeValue: false,
    companyName: 'Ashfield Finishes',
    status: hidden?.current.status ?? 'Draft',
    valuePence: hidden?.current.value_pence ?? null,
    confirmationText: hidden?.current.signature?.confirmation_text ?? null,
    shownValuePence: hidden?.current.signature?.shown_value_pence ?? null,
    hasSignature: hidden?.current.signature != null,
  });
  assert.equal(operativePriced.line, 'Amount: agreed with the office. Ask Ashfield Finishes for the priced copy.');
  assert.equal(operativePriced.hint, null);
  assert.equal(operativePriced.line?.includes('£'), false);
  assert.equal(variationListAmount(mastic, false), null);

  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const visible = await fixtureRepo.getVariation(mastic.variation_id);
  assert.equal(visible?.current.value_pence, 18000);
  assert.equal(visible?.current.signature?.shown_value_pence, 18000);
  const agreed = variationScreenAmount({
    seeValue: true,
    companyName: 'Ashfield Finishes',
    status: visible?.current.status ?? 'Draft',
    valuePence: visible?.current.value_pence ?? null,
    confirmationText: visible?.current.signature?.confirmation_text ?? null,
    shownValuePence: visible?.current.signature?.shown_value_pence ?? null,
    hasSignature: visible?.current.signature != null,
  });
  assert.equal(agreed.line, 'Amount · £180.00 + VAT');
  assert.equal(agreed.hint, null);
  assert.equal(agreed.line?.includes('not yet agreed'), false);
  const ownerList = await fixtureRepo.listVariations(IDS.oak);
  const ownerMastic = ownerList.rows.find((row) => row.title === 'Additional mastic');
  assert.ok(ownerMastic);
  assert.equal(variationListAmount(ownerMastic, true), '£180.00 + VAT');
  const soffit = ownerList.rows.find((row) => row.title === 'Extra angle beads to the soffit');
  assert.ok(soffit);
  assert.equal(soffit.value_pence, 14550);
  assert.equal(soffit.shown_value_pence, null);
  assert.equal(soffit.signed_without_price, true);
  assert.equal(variationListAmount(soffit, true), '£145.50 · not agreed');
  const unsigned = await fixtureRepo.getVariation(soffit.variation_id);
  const notAgreed = variationScreenAmount({
    seeValue: true,
    companyName: 'Ashfield Finishes',
    status: unsigned?.current.status ?? 'Draft',
    valuePence: unsigned?.current.value_pence ?? null,
    confirmationText: unsigned?.current.signature?.confirmation_text ?? null,
    shownValuePence: unsigned?.current.signature?.shown_value_pence ?? null,
    hasSignature: unsigned?.current.signature != null,
  });
  assert.equal(notAgreed.line, 'Amount · £145.50 + VAT, not yet agreed. Signed before a price was set.');
  assert.equal(notAgreed.hint, 'To get it signed at this price: Edit as new version, then hand over.');
  assert.equal(unsigned?.current.signature?.confirmation_text, variationConfirmation('Northbuild', false));

  const created = await fixtureRepo.createVariation({
    siteId: IDS.oak,
    title: 'Priced beads',
    description: 'Shown amount',
    photos: [{ storagePath: `${IDS.company}/${IDS.oak}/variations/priced.jpg`, contentType: 'image/jpeg', fileSizeBytes: 1200 }],
    valuePence: 14550,
  });
  await assert.rejects(
    () =>
      fixtureRepo.signVariation(created.versionId, {
        signerName: 'Dave Moran',
        role: 'Site manager',
        company: 'Northbuild',
        expectedPence: 1,
        signaturePng: 'data:image/png;base64,' + 'A'.repeat(40),
      }),
    /value_mismatch/
  );
  await fixtureRepo.signVariation(created.versionId, {
    signerName: 'Dave Moran',
    role: 'Site manager',
    company: 'Northbuild',
    expectedPence: 14550,
    signaturePng: 'data:image/png;base64,' + 'A'.repeat(40),
  });
  const priced = await fixtureRepo.getVariation(created.variationId);
  assert.equal(priced?.current.signature?.confirmation_text, variationConfirmation('Northbuild', true));
  assert.equal(priced?.current.signature?.shown_value_pence, 14550);

  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const asOperative = await fixtureRepo.getVariation(created.variationId);
  assert.equal(asOperative?.current.value_pence, null);
  assert.equal(asOperative?.current.signature?.shown_value_pence, null);
  assert.equal(asOperative?.current.signature?.confirmation_text, variationConfirmation('Northbuild', true));

  await assert.rejects(
    () =>
      fixtureRepo.createVariation({
        siteId: IDS.oak,
        title: 'Bad path',
        description: 'Note',
        photos: [{ storagePath: `${IDS.company}/${IDS.oak}/../bad.jpg`, contentType: 'image/jpeg', fileSizeBytes: 10 }],
      }),
    /invalid_path/
  );
  await assert.rejects(
    () =>
      fixtureRepo.createVariation({
        siteId: IDS.oak,
        title: 'Slash path',
        description: 'Note',
        photos: [{ storagePath: '/variations/bad.jpg', contentType: 'image/jpeg', fileSizeBytes: 10 }],
      }),
    /invalid_path/
  );
});

test('the migration is one file and names the RLS policies', () => {
  const names = fs
    .readdirSync('supabase/migrations')
    .filter((name) => name.endsWith('.sql') && name.slice(0, 14) > '20261021210000');
  assert.deepEqual(
    names.filter((name) => name.includes('variation')),
    ['20261022150000_variations.sql']
  );
  const sql = fs.readFileSync('supabase/migrations/20261022150000_variations.sql', 'utf8');
  for (const policy of [
    'variations_select',
    'variation_versions_select',
    'variation_photos_select',
    'variation_signatures_select',
    'variation_counters_select',
    'site_photos_select',
    'site_photos_insert',
  ]) {
    assert.match(sql, new RegExp(`create policy ${policy}`));
  }
  assert.match(sql, /variation_locked/);
  assert.match(sql, /value_not_allowed/);
  assert.match(sql, /value_mismatch/);
  assert.match(sql, /shown_value_pence/);
  assert.match(sql, /private\.can_see_variation_value/);
  assert.match(sql, /revoke select \(value_pence\)/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /site-photos/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /private\.can_access_site/);
  assert.match(sql, /private\.variation_signed_without_price/);
  assert.match(sql, /'shown_value_pence', private\.visible_shown_pence\(ver\.id\)/);
  assert.match(sql, /'signed_without_price', private\.variation_signed_without_price\(ver\.id\)/);
  assert.match(sql, /revoke all on function private\.variation_signed_without_price\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function private\.variation_signed_without_price\(uuid\) to authenticated/);
  assert.match(sql, /strpos\(v_path, '\.\.'\)/);
  assert.doesNotMatch(sql, /service_role/);
  const probe = fs.readFileSync('scripts/variations-rls.sql', 'utf8');
  assert.match(probe, /operative cannot set the pound value/);
  assert.match(probe, /cannot be edited in place/);
  assert.match(probe, /firm X cannot read firm Y/);
  assert.match(probe, /site B variations or photos/);
  assert.match(probe, /anon cannot execute any variation function/);
  assert.match(probe, /operative list, detail and version json return a null pound amount/);
  assert.match(probe, /an operative cannot revise a signed variation/);
  assert.match(probe, /a sign-off rejects an amount that is not the stored value/);
  assert.match(probe, /an operative list hides the snapshot and marks a sign-off with no price/);
  assert.match(probe, /a same-company manager lists a signed variation whose snapshot is null/);
  assert.match(probe, /an operative list of a priced sign-off has a null snapshot/);
  assert.match(probe, /a manager in another company cannot read the pound amount/);
  const detail = fs.readFileSync('app/(app)/sites/[siteId]/variations/[variationId].tsx', 'utf8');
  assert.match(detail, /canSeeVariationValue/);
  assert.match(detail, /expectedPence: seeValue \? current\.value_pence : null/);
  assert.match(detail, /shown_value_pence/);
  const queue = fs.readFileSync('app/(app)/sites/[siteId]/variations/new.tsx', 'utf8');
  assert.match(queue, /ownerUserId: userId/);
  assert.match(queue, /auth_user_id/);
});
