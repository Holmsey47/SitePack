import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import {
  filterVariations,
  formatPounds,
  parsePounds,
  variationCounts,
  variationPdfFilename,
} from './variations.ts';
import { formatUkDateTime } from '../lib/format.ts';

test('pounds parse and the UK clock', () => {
  assert.equal(parsePounds(''), null);
  assert.equal(parsePounds('£12.50'), 1250);
  assert.equal(parsePounds('1,250.5'), 125050);
  assert.equal(formatPounds(18000), '£180.00');
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
  assert.equal(oak.signed_count, 1);
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
    roleCompany: 'Site manager, Northbuild',
    signaturePng: 'data:image/png;base64,' + 'A'.repeat(40),
  });
  await assert.rejects(
    () => fixtureRepo.setVariationValue(draft.version_id, 50),
    /value_not_allowed|variation_locked/
  );
  const locked = await fixtureRepo.getVariation(draft.variation_id);
  assert.equal(locked?.current.status, 'Signed');
  assert.equal(locked?.current.signature?.signer_name, 'Dave Moran');
  const revised = await fixtureRepo.reviseVariation(draft.version_id);
  const after = await fixtureRepo.getVariation(draft.variation_id);
  assert.equal(after?.current.version_id, revised.versionId);
  assert.equal(after?.current.status, 'Draft');
  assert.equal(after?.current.value_pence, null);
  assert.equal(after?.history[0]?.status, 'Signed');
  assert.equal(after?.history[0]?.signature?.signer_name, 'Dave Moran');
  assert.equal(after?.history[0]?.title, before?.current.title);
});

test('the migration is one file and names the RLS policies', () => {
  const names = fs
    .readdirSync('supabase/migrations')
    .filter((name) => name.endsWith('.sql') && name.slice(0, 14) > '20261021210000');
  assert.deepEqual(names, ['20261022150000_variations.sql']);
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
  assert.match(sql, /site-photos/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /private\.can_access_site/);
  assert.doesNotMatch(sql, /service_role/);
  const probe = fs.readFileSync('scripts/variations-rls.sql', 'utf8');
  assert.match(probe, /operative cannot set the pound value/);
  assert.match(probe, /cannot be edited in place/);
  assert.match(probe, /firm X cannot read firm Y/);
  assert.match(probe, /site B variations or photos/);
});
