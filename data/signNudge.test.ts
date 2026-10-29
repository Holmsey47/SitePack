import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import { SITE_DOCUMENT_URL_SECONDS } from './siteDocuments.ts';
import {
  loadSignNudge,
  rowsFromSignNudgeRead,
  signNudgeLabel,
  signNudgeTarget,
  signNudgeVisible,
  unsignedSignDocuments,
  type SignNudgeRow,
} from './signNudge.ts';

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const oak = 'Plot 12 – Oak Estate';

function row(overrides: Partial<SignNudgeRow> = {}): SignNudgeRow {
  return {
    id: 'doc-1',
    siteId: 'site-1',
    siteName: oak,
    kind: 'rams',
    title: 'Roof RAMS',
    archivedAt: null,
    assigned: true,
    versionId: 'ver-1',
    current: true,
    signerIds: [],
    ...overrides,
  };
}

const amy = { id: 'amy', role: 'operative' as const };
const priya = { id: 'cm', role: 'cm' as const };
const jordan = { id: 'owner', role: 'owner' as const };

test('unsigned RAMS and inductions are the nudge, and a signature on the current version removes it', () => {
  const induction = row({ id: 'ind', kind: 'induction', title: 'Site induction' });
  const rams = row({ id: 'rams', title: 'Roof RAMS' });
  const toolbox = row({ id: 'box', kind: 'toolbox', title: 'Friday talk' });
  const open = unsignedSignDocuments([induction, rams, toolbox], amy);
  assert.deepEqual(
    open.map((doc) => doc.title),
    ['Roof RAMS', 'Site induction'],
  );
  assert.equal(signNudgeLabel(open), '2 documents to sign');
  assert.equal(signNudgeTarget(open)?.kind, 'list');
  assert.equal(signNudgeVisible(open), true);

  const signed = unsignedSignDocuments([induction, { ...rams, signerIds: ['amy'] }], amy);
  assert.deepEqual(signed.map((doc) => doc.id), ['ind']);
  assert.equal(signNudgeLabel(signed), `Sign Induction: Site induction · ${oak}`);
  assert.deepEqual(signNudgeTarget(signed), { kind: 'document', siteId: 'site-1', documentId: 'ind' });
});

test('an archived document, an old version, and a site the person is not on do not nudge', () => {
  const docs = unsignedSignDocuments(
    [
      row({ id: 'archived', archivedAt: '2026-10-01T00:00:00.000Z' }),
      row({ id: 'old', current: false, versionId: 'ver-old' }),
      row({ id: 'away', assigned: false, siteId: 'other', siteName: 'Warehouse – North Yard' }),
      row({ id: 'live', title: 'Live RAMS' }),
    ],
    amy,
  );
  assert.deepEqual(docs.map((doc) => doc.id), ['live']);
});

test('a contracts manager and an owner only see documents they themselves must sign', () => {
  const shared = [
    row({ signerIds: ['amy'] }),
    row({ id: 'cm-open', title: 'CM RAMS', signerIds: [] }),
  ];
  assert.deepEqual(
    unsignedSignDocuments(shared, priya).map((doc) => doc.id),
    ['cm-open', 'doc-1'],
  );
  assert.deepEqual(
    unsignedSignDocuments([{ ...shared[1], signerIds: ['cm'] }], priya).map((doc) => doc.id),
    [],
  );
  assert.deepEqual(unsignedSignDocuments(shared, jordan), []);
  assert.equal(signNudgeLabel([]), null);
  assert.equal(signNudgeTarget([]), null);
  assert.equal(signNudgeVisible([]), false);
  assert.equal(signNudgeVisible(null), false);
});

test('a failed read shows no nudge', async () => {
  const failed = await loadSignNudge(async () => {
    throw new Error('permission denied https://example.supabase.co/rest/v1/site_documents');
  });
  assert.equal(failed, null);
  assert.equal(signNudgeVisible(failed), false);
  assert.equal(signNudgeLabel(failed ?? []), null);
  assert.equal(await loadSignNudge(async () => null as unknown as []), null);
});

test('the nested read keeps unsigned rows and drops signed, archived, and unassigned ones', () => {
  const rows = rowsFromSignNudgeRead(
    [
      {
        id: 'live',
        site_id: 'site-1',
        kind: 'rams',
        title: 'Roof RAMS',
        archived_at: null,
        sites: { name: oak, site_assignments: [{ person_id: 'amy' }] },
        site_document_versions: [{ id: 'ver-2', is_current: true, site_document_signatures: [] }],
      },
      {
        id: 'signed',
        site_id: 'site-1',
        kind: 'induction',
        title: 'Site induction',
        archived_at: null,
        sites: { name: oak, site_assignments: [{ person_id: 'amy' }] },
        site_document_versions: [
          { id: 'ver-old', is_current: false, site_document_signatures: [] },
          { id: 'ver-1', is_current: true, site_document_signatures: [{ person_id: 'amy' }] },
        ],
      },
      {
        id: 'archived',
        site_id: 'site-1',
        kind: 'rams',
        title: 'Old RAMS',
        archived_at: '2026-10-01T00:00:00.000Z',
        sites: { name: oak, site_assignments: [{ person_id: 'amy' }] },
        site_document_versions: [{ id: 'ver-a', is_current: true, site_document_signatures: [] }],
      },
      {
        id: 'away',
        site_id: 'site-2',
        kind: 'rams',
        title: 'Other site',
        archived_at: null,
        sites: { name: 'Warehouse – North Yard', site_assignments: [{ person_id: 'someone-else' }] },
        site_document_versions: [{ id: 'ver-w', is_current: true, site_document_signatures: [] }],
      },
    ],
    'amy',
  );
  assert.deepEqual(
    unsignedSignDocuments(rows, amy).map((doc) => doc.id),
    ['live'],
  );
  assert.throws(() => rowsFromSignNudgeRead({ id: 'nope' }, 'amy'), /Could not read documents to sign/);
});

test('the home query is one read, and a failed one is not shown as a card', () => {
  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
  const start = repo.indexOf('async listUnsignedSiteDocuments');
  const end = repo.indexOf('async listSiteDocuments');
  const method = repo.slice(start, end);
  assert.equal(method.split('.from(').length - 1, 1);
  assert.equal(method.includes('.rpc('), false);
  assert.match(method, /memberMustSign/);
  assert.match(method, /site_assignments/);
  assert.match(method, /is_current/);
  const home = fs.readFileSync('app/(app)/sites/index.tsx', 'utf8');
  assert.match(home, /loadSignNudge/);
  assert.match(home, /signNudgeVisible/);
  assert.match(home, /useFocusEffect/);
  assert.equal(SITE_DOCUMENT_URL_SECONDS, 300);
  assert.match(repo, /createSignedUrl\(storagePath, SITE_DOCUMENT_URL_SECONDS\)/);
  assert.doesNotMatch(repo, /from\('site-documents'\)\.createSignedUrl\([^)]*3600/);
});

test('fixture nudge follows unsigned, signed, archived, and unassigned', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const open = await fixtureRepo.listUnsignedSiteDocuments();
  assert.equal(open.length, 1);
  assert.equal(open[0].kind, 'induction');
  assert.equal(signNudgeLabel(open), `Sign Induction: Site induction · ${oak}`);
  assert.equal(open.some((doc) => doc.title === 'A toolbox talk'), false);

  await fixtureRepo.signSiteDocument({
    documentId: open[0].id,
    versionId: open[0].versionId,
    siteId: IDS.oak,
    personId: IDS.amy,
    signerName: 'Amy Keane',
  });
  assert.deepEqual(await fixtureRepo.listUnsignedSiteDocuments(), []);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  assert.deepEqual(await fixtureRepo.listUnsignedSiteDocuments(), []);
  await fixtureRepo.replaceSiteDocument({
    documentId: open[0].id,
    createdBy: IDS.owner,
    fileName: 'v2.pdf',
    bytes: pdfBytes,
  });
  const created = await fixtureRepo.createSiteDocument({
    siteId: IDS.warehouse,
    companyId: IDS.company,
    createdBy: IDS.owner,
    title: 'Yard RAMS',
    kind: 'rams',
    fileName: 'yard.pdf',
    bytes: pdfBytes,
  });
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const again = await fixtureRepo.listUnsignedSiteDocuments();
  assert.equal(again.length, 1);
  assert.equal(again[0].id, open[0].id);
  assert.equal(again.some((doc) => doc.id === created.id), false);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  const manager = await fixtureRepo.listUnsignedSiteDocuments();
  assert.equal(manager.some((doc) => doc.id === created.id), true);
  assert.equal(manager.some((doc) => doc.id === open[0].id), true);
  const induction = manager.find((doc) => doc.id === open[0].id);
  await fixtureRepo.signSiteDocument({
    documentId: induction!.id,
    versionId: induction!.versionId,
    siteId: IDS.oak,
    personId: IDS.cm,
    signerName: 'Priya Shah',
  });
  const afterCm = await fixtureRepo.listUnsignedSiteDocuments();
  assert.equal(afterCm.some((doc) => doc.id === open[0].id), false);
  assert.equal(afterCm.some((doc) => doc.id === created.id), true);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  assert.equal((await fixtureRepo.listUnsignedSiteDocuments()).some((doc) => doc.id === open[0].id), true);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const second = await fixtureRepo.createSiteDocument({
    siteId: IDS.oak,
    companyId: IDS.company,
    createdBy: IDS.owner,
    title: 'Oak RAMS',
    kind: 'rams',
    fileName: 'oak.pdf',
    bytes: pdfBytes,
  });
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const several = await fixtureRepo.listUnsignedSiteDocuments();
  assert.equal(several.length, 2);
  assert.equal(signNudgeLabel(several), '2 documents to sign');
  assert.equal(signNudgeTarget(several)?.kind, 'list');
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.removeAssignment('aaaaaaaa-0001-0000-0000-000000000002');
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const unassigned = await fixtureRepo.listUnsignedSiteDocuments();
  assert.equal(unassigned.some((doc) => doc.id === second.id), false);
  assert.equal(unassigned.some((doc) => doc.id === open[0].id), false);
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.addAssignment(IDS.oak, IDS.amy);
  await fixtureRepo.archiveSiteDocument(open[0].id);
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const gone = await fixtureRepo.listUnsignedSiteDocuments();
  assert.equal(gone.some((doc) => doc.id === open[0].id), false);
  assert.equal(gone.some((doc) => doc.id === second.id), true);
  assert.equal(gone.some((doc) => doc.id === created.id), false);
});
