import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import {
  SITE_DOCUMENT_KINDS,
  SITE_DOCUMENT_MAX_BYTES,
  memberMustSign,
  signRoster,
  siteDocumentBytesError,
  orderedSiteDocuments,
  clearArchivedDocuments,
  rememberArchivedDocument,
  siteDocumentKindLabel,
  siteDocumentSignLabel,
  siteDocumentPath,
  siteDocumentPickError,
  siteDocumentStatusLine,
} from './siteDocuments.ts';

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

test('an archived document says Archived on the first paint, before the list refetches', () => {
  const live = { id: 'doc-live', archived_at: null, version_no: 2, owner: true, signed: false };
  assert.equal(siteDocumentStatusLine(live), 'Version 2');
  assert.equal(siteDocumentStatusLine({ ...live, id: 'doc-signed', owner: false, signed: true }), 'Signed');
  assert.equal(siteDocumentStatusLine({ ...live, id: 'doc-open', owner: false, signed: false }), 'To sign');
  assert.equal(
    siteDocumentStatusLine({ ...live, id: 'doc-stored', archived_at: '2026-10-01T00:00:00.000Z' }),
    'Archived',
  );
  rememberArchivedDocument('doc-just-archived');
  assert.equal(
    siteDocumentStatusLine({ ...live, id: 'doc-just-archived', archived_at: null }),
    'Archived',
  );
  assert.deepEqual(
    orderedSiteDocuments([
      { id: 'doc-just-archived', title: 'Alpha', archived_at: null },
      { id: 'doc-live', title: 'Bravo', archived_at: null },
    ]).map((row) => row.title),
    ['Bravo', 'Alpha'],
  );
  clearArchivedDocuments();
  assert.equal(
    siteDocumentStatusLine({ ...live, id: 'doc-just-archived', archived_at: null }),
    'Version 2',
  );
});

test('document types are Induction, Toolbox talk, and RAMS', () => {
  assert.deepEqual(
    SITE_DOCUMENT_KINDS.map((item) => item.label),
    ['Induction', 'Toolbox talk', 'RAMS'],
  );
  assert.equal(siteDocumentKindLabel('toolbox'), 'Toolbox talk');
  assert.equal(siteDocumentSignLabel('induction'), "I've read the site induction and understand it");
  assert.equal(siteDocumentSignLabel('toolbox'), "I've read the toolbox talk and understand it");
  assert.equal(siteDocumentSignLabel('rams'), "I've read the RAMS and understand it");
  assert.deepEqual(
    orderedSiteDocuments([
      { title: 'Alpha', archived_at: '2026-10-01T00:00:00.000Z' },
      { title: 'Zulu', archived_at: null },
      { title: 'Bravo', archived_at: null },
    ]).map((row) => row.title),
    ['Bravo', 'Zulu', 'Alpha'],
  );
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
      bytes: pdfBytes,
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

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  await assert.rejects(
    fixtureRepo.deleteSiteDocument(induction!.id),
    /Archive it instead/,
  );
  await fixtureRepo.archiveSiteDocument(induction!.id);
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const hidden = await fixtureRepo.listSiteDocuments(IDS.oak);
  assert.equal(hidden.some((row) => row.id === induction!.id), false);
});

test('oak lists a live document above an archived one', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const rows = orderedSiteDocuments(await fixtureRepo.listSiteDocuments(IDS.oak));
  assert.deepEqual(
    rows.map((row) => [row.title, row.archived_at != null]),
    [
      ['Site induction', false],
      ['A toolbox talk', true],
    ],
  );
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const visible = await fixtureRepo.listSiteDocuments(IDS.oak);
  assert.equal(visible.some((row) => row.title === 'A toolbox talk'), false);
  assert.equal(visible.some((row) => row.title === 'Site induction'), true);
});

test('a PDF under 20MB is accepted and anything else is refused', () => {
  assert.equal(siteDocumentPickError({ name: 'notes.txt', mimeType: 'text/plain', size: 12 }), 'Choose a PDF.');
  assert.equal(
    siteDocumentPickError({ name: 'big.pdf', mimeType: 'application/pdf', size: SITE_DOCUMENT_MAX_BYTES + 1 }),
    'That PDF is larger than 20MB.',
  );
  assert.equal(siteDocumentPickError({ name: 'ok.pdf', mimeType: 'application/pdf', size: pdfBytes.byteLength }), null);
  assert.equal(siteDocumentBytesError(new Uint8Array([1, 2, 3, 4])), 'Choose a PDF.');
  assert.equal(siteDocumentBytesError(pdfBytes), null);
  const huge = new Uint8Array(SITE_DOCUMENT_MAX_BYTES + 1);
  huge.set(pdfBytes);
  assert.equal(siteDocumentBytesError(huge), 'That PDF is larger than 20MB.');
});

test('the site page opens Induction and RAMS, and the migration keeps writes with the owner', () => {
  const site = fs.readFileSync('app/(app)/sites/[siteId]/index.tsx', 'utf8');
  const list = fs.readFileSync('app/(app)/sites/[siteId]/documents/index.tsx', 'utf8');
  const upload = fs.readFileSync('app/(app)/sites/[siteId]/documents/new.tsx', 'utf8');
  const detail = fs.readFileSync('app/(app)/sites/[siteId]/documents/[documentId].tsx', 'utf8');
  const migration = fs.readFileSync('supabase/migrations/20261027120000_site_documents.sql', 'utf8');

  assert.match(site, /Induction & RAMS/);
  assert.match(site, /numberOfLines=\{2\}/);
  assert.match(site, /headerTitle: \(\) => null/);
  assert.match(site, /minHeight=\{48\}/);
  const wording = fs.readFileSync('data/siteDocuments.ts', 'utf8');
  assert.match(list, /siteDocumentStatusLine/);
  assert.match(wording, /To sign/);
  assert.match(wording, /return 'Archived'/);
  assert.match(detail, /siteDocumentStatusLine/);
  assert.match(detail, /rememberArchivedDocument/);
  assert.match(upload, /person\.role !== 'owner'/);
  assert.match(upload, /Choose PDF/);
  assert.match(detail, /siteDocumentSignLabel\(detail\.kind\)/);
  assert.match(detail, /formatSignedWhen/);
  assert.match(detail, /Signed \$\{signedWhen\}/);
  assert.match(wording, /I've read the site induction and understand it/);
  assert.match(wording, /I've read the toolbox talk and understand it/);
  assert.match(wording, /I've read the RAMS and understand it/);
  assert.match(detail, /minHeight=\{56\}/);
  assert.match(detail, /Archive this document/);
  assert.match(detail, /scrollToEnd/);
  assert.ok(detail.indexOf('Archive this document') < detail.indexOf('label="Cancel"'));
  assert.ok(detail.indexOf('Delete this document') < detail.indexOf('label="Cancel"'));
  assert.ok(detail.indexOf('Save new version') < detail.indexOf('label="Archive document"'));
  assert.match(detail, /marginTop: space\.xl/);
  assert.match(list, /orderedSiteDocuments/);
  assert.match(list, /archived \? theme\.muted/);
  assert.match(upload, /siteDocumentPickError/);
  assert.match(upload, /base64: false/);
  assert.match(detail, /Who has signed/);
  assert.match(detail, /memberMustSign/);

  assert.match(migration, /kind in \('induction', 'toolbox', 'rams'\)/);
  assert.match(migration, /private\.can_access_site\(site_id\)/);
  assert.match(migration, /private\.my_role\(\) = 'owner'/);
  assert.match(migration, /v\.is_current/);
  assert.match(migration, /v\.site_id = site_document_signatures\.site_id/);
  assert.match(migration, /v\.document_id = site_document_signatures\.document_id/);
  assert.match(migration, /site_document_has_signatures/);
  assert.match(migration, /site_photo_is_orphan/);
  assert.match(migration, /public\.snag_photos/);
  assert.match(migration, /public\.variation_photos/);
  assert.match(migration, /20971520/);
  assert.equal(migration.includes('grant execute on function private.supersede_site_document_version()'), false);
  assert.equal(migration.includes('grant execute on function private.stamp_site_document_signature()'), false);
  assert.match(migration, /new\.signed_at := now\(\)/);
  assert.match(migration, /new\.is_current := true/);
  assert.match(migration, /bucket_id = 'site-documents'/);
  assert.match(migration, /site_documents_storage_delete/);
  assert.match(migration, /create policy site_photos_delete/);
  assert.match(migration, /bucket_id = 'site-photos'/);
  assert.match(migration, /private\.site_document_path_matches\(name\)/);
  assert.match(migration, /d\.site_id = private\.storage_site_id\(p_name\)/);
  assert.match(migration, /d\.company_id = private\.storage_company_id\(p_name\)/);
  assert.match(migration, /d\.site_id = private\.storage_site_id\(name\)/);
  assert.match(migration, /d\.company_id = private\.storage_company_id\(name\)/);
  assert.match(migration, /revoke all on function private\.site_document_path_matches\(text\) from public, anon/);
  assert.equal(
    migration.includes('grant execute on function private.site_document_path_matches(text) to anon'),
    false,
  );
  assert.equal(
    migration.includes('grant execute on function private.site_document_path_matches(text) to public'),
    false,
  );
  assert.match(migration, /private\.storage_company_id\(name\) = private\.my_company_id\(\)/);
  assert.equal(migration.includes('grant select, insert, delete on table public.site_documents'), true);
  assert.equal(migration.includes('for update') && migration.includes('site_document_signatures for update'), false);

  const probes = fs.readFileSync('scripts/site-documents-rls.sql', 'utf8');
  assert.match(probes, /private\.site_photo_is_orphan/);
  assert.match(probes, /site_photo_is_orphan is true only for an unreferenced photo in the owner company/);
  assert.match(probes, /a member is refused by site_photo_is_orphan/);
  assert.match(probes, /a member is refused when deleting an orphan site photo/);
  assert.match(probes, /another company owner is refused by site_photo_is_orphan/);
  assert.match(probes, /another company owner is refused when deleting a site photo/);
  assert.match(probes, /the owner can delete an orphan site photo but not one a snag or variation still uses/);
});
