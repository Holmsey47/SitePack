import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import {
  SITE_DOCUMENT_KINDS,
  memberMustSign,
  signRoster,
  siteDocumentKindLabel,
  siteDocumentPath,
} from './siteDocuments.ts';

test('document types are Induction, Toolbox talk, and RAMS', () => {
  assert.deepEqual(
    SITE_DOCUMENT_KINDS.map((item) => item.label),
    ['Induction', 'Toolbox talk', 'RAMS'],
  );
  assert.equal(siteDocumentKindLabel('toolbox'), 'Toolbox talk');
  assert.equal(memberMustSign('operative'), true);
  assert.equal(memberMustSign('cm'), true);
  assert.equal(memberMustSign('owner'), false);
  assert.equal(
    siteDocumentPath('company', 'site', 'doc', 'ver'),
    'company/site/doc/ver.pdf',
  );
});

test('the sign roster is assigned operatives and contracts managers, unsigned first', () => {
  const roster = signRoster(
    [
      { person_id: 'owner', person: { role: 'owner', display_name: 'Jordan' } },
      { person_id: 'cm', person: { role: 'cm', display_name: 'Priya' } },
      { person_id: 'op', person: { role: 'operative', display_name: 'Amy' } },
    ],
    [{ person_id: 'cm', signed_at: '2026-10-27T12:00:00.000Z' }],
  );
  assert.deepEqual(
    roster.map((row) => [row.person_id, row.signed_at != null]),
    [
      ['op', false],
      ['cm', true],
    ],
  );
});

test('a new version needs a new signature, and only the owner uploads', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const first = await fixtureRepo.listSiteDocuments(IDS.oak);
  const induction = first.find((row) => row.title === 'Site induction');
  assert.equal(induction?.kind, 'induction');
  assert.equal(induction?.signed_by_me, false);
  assert.equal(induction?.version_no, 1);
  await assert.rejects(
    fixtureRepo.createSiteDocument({
      siteId: IDS.oak,
      companyId: IDS.company,
      createdBy: IDS.amy,
      title: 'Extra',
      kind: 'rams',
      fileName: 'rams.pdf',
      bytes: new Uint8Array([1]),
    }),
    /not_authorized/,
  );
  await fixtureRepo.signSiteDocument({
    documentId: induction!.id,
    versionId: induction!.version_id,
    siteId: IDS.oak,
    personId: IDS.amy,
    signerName: 'Amy Keane',
  });
  const signed = await fixtureRepo.listSiteDocuments(IDS.oak);
  assert.equal(signed.find((row) => row.id === induction!.id)?.signed_by_me, true);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const before = await fixtureRepo.getSiteDocument(induction!.id);
  assert.equal(before?.signatures.length, 1);
  await fixtureRepo.replaceSiteDocument({
    documentId: induction!.id,
    createdBy: IDS.owner,
    fileName: 'v2.pdf',
    bytes: new Uint8Array([2]),
  });
  const next = await fixtureRepo.getSiteDocument(induction!.id);
  assert.equal(next?.version_no, 2);
  assert.equal(next?.signatures.length, 0);
  const assigned = await fixtureRepo.listAssignments(IDS.oak);
  const roster = signRoster(assigned, next?.signatures ?? []);
  assert.equal(roster.some((row) => row.name === 'Amy Keane' && row.signed_at == null), true);
  assert.equal(roster.some((row) => row.name === 'Jordan Hale'), false);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const again = await fixtureRepo.listSiteDocuments(IDS.oak);
  assert.equal(again.find((row) => row.id === induction!.id)?.signed_by_me, false);
  await fixtureRepo.signSiteDocument({
    documentId: induction!.id,
    versionId: again.find((row) => row.id === induction!.id)!.version_id,
    siteId: IDS.oak,
    personId: IDS.amy,
    signerName: 'Amy Keane',
  });
  await assert.rejects(
    fixtureRepo.deleteSiteDocument(induction!.id),
    /not_authorized/,
  );
});

test('the site page opens Induction and RAMS, and the migration keeps writes with the owner', () => {
  const site = fs.readFileSync('app/(app)/sites/[siteId]/index.tsx', 'utf8');
  const list = fs.readFileSync('app/(app)/sites/[siteId]/documents/index.tsx', 'utf8');
  const upload = fs.readFileSync('app/(app)/sites/[siteId]/documents/new.tsx', 'utf8');
  const detail = fs.readFileSync('app/(app)/sites/[siteId]/documents/[documentId].tsx', 'utf8');
  const migration = fs.readFileSync('supabase/migrations/20261027120000_site_documents.sql', 'utf8');

  assert.match(site, /label="Induction & RAMS"/);
  assert.match(site, /minHeight=\{48\}/);
  assert.match(list, /To sign/);
  assert.match(upload, /person\.role !== 'owner'/);
  assert.match(upload, /Choose PDF/);
  assert.match(detail, /I have read and understood/);
  assert.match(detail, /minHeight=\{56\}/);
  assert.match(detail, /Who has signed/);
  assert.match(detail, /memberMustSign/);

  assert.match(migration, /kind in \('induction', 'toolbox', 'rams'\)/);
  assert.match(migration, /private\.can_access_site\(site_id\)/);
  assert.match(migration, /private\.my_role\(\) = 'owner'/);
  assert.match(migration, /v\.is_current/);
  assert.match(migration, /new\.signed_at := now\(\)/);
  assert.match(migration, /new\.is_current := true/);
  assert.match(migration, /bucket_id = 'site-documents'/);
  assert.match(migration, /site_documents_storage_delete/);
  assert.equal(migration.includes('grant select, insert, delete on table public.site_documents'), true);
  assert.equal(migration.includes('for update') && migration.includes('site_document_signatures for update'), false);
});
