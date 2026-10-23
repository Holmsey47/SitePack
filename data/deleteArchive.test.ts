import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import { pathsToClear, revisionFamilyIds, sheetKeyOf, type RevisionRow } from './drawingDelete.ts';
import { ARCHIVE_SITE_CONFIRM, DELETE_DRAWING_CONFIRM, RESTORE_SITE_CONFIRM, workingRows } from './walk.ts';

test('revision family includes the chain and the same sheet', () => {
  const rows: RevisionRow[] = [
    { id: 'old', siteId: 'oak', title: 'GA', sheetKey: 'A-101', supersedesId: null },
    { id: 'loose', siteId: 'oak', title: 'GA', sheetKey: 'A-101', supersedesId: null },
    { id: 'new', siteId: 'oak', title: 'GA', sheetKey: 'A-101', supersedesId: 'old' },
    { id: 'other', siteId: 'oak', title: 'Section', sheetKey: 'A-201', supersedesId: null },
    { id: 'linked', siteId: 'oak', title: 'Renamed', sheetKey: 'A-101-old', supersedesId: 'new' },
  ];
  assert.deepEqual(sheetKeyOf(' A-101 '), 'A-101');
  assert.deepEqual(revisionFamilyIds('old', rows).sort(), ['linked', 'loose', 'new', 'old']);
  assert.deepEqual(revisionFamilyIds('loose', rows).sort(), ['linked', 'loose', 'new', 'old']);
  assert.deepEqual(revisionFamilyIds('missing', rows), []);
});

test('storage failure keeps every path pending and a partial remove clears only what dropped', () => {
  assert.deepEqual(pathsToClear(['a', 'b'], [], true), { clear: [], pending: ['a', 'b'] });
  assert.deepEqual(pathsToClear(['a', 'b'], ['a'], true), { clear: ['a'], pending: ['b'] });
  assert.deepEqual(pathsToClear(['a', 'b'], ['a', 'b'], false), { clear: ['a', 'b'], pending: [] });
});

test('owner delete removes every revision and leaves the request', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  await assert.rejects(() => fixtureRepo.deleteDrawing(IDS.gfRevC), /not_authorized/);
  assert.equal((await fixtureRepo.getDrawing(IDS.gfRevB))?.id, IDS.gfRevB);
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const request = await fixtureRepo.getRequest(IDS.openRequest);
  assert.ok(request);
  await fixtureRepo.updateRequest(IDS.openRequest, { status: 'Closed', fulfilled_drawing_id: IDS.gfRevC });
  const paths = await fixtureRepo.deleteDrawing(IDS.gfRevB);
  assert.deepEqual(paths.sort(), [
    `${IDS.company}/${IDS.oak}/${IDS.gfRevB}.pdf`,
    `${IDS.company}/${IDS.oak}/${IDS.gfRevC}.pdf`,
  ]);
  assert.equal(await fixtureRepo.getDrawing(IDS.gfRevB), null);
  assert.equal(await fixtureRepo.getDrawing(IDS.gfRevC), null);
  assert.equal((await fixtureRepo.getDrawing(IDS.ffRevA))?.id, IDS.ffRevA);
  const kept = await fixtureRepo.getRequest(IDS.openRequest);
  assert.equal(kept?.fulfilled_drawing_id, null);
  await assert.rejects(() => fixtureRepo.deleteDrawing(IDS.gfRevC), /drawing_not_found/);
});

test('archived sites stay for the owner and disappear for members', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.archiveSite(IDS.oak, true);
  const archived = (await fixtureRepo.companySitesPulse()).find((site) => site.site_id === IDS.oak);
  assert.ok(archived?.archived_at);
  assert.equal(workingRows([archived]).length, 0);
  assert.equal((await fixtureRepo.getSite(IDS.oak))?.id, IDS.oak);
  await assert.rejects(() => fixtureRepo.createRequest({ siteId: IDS.oak, body: 'A section' }), /site_archived/);
  await assert.rejects(
    () =>
      fixtureRepo.replaceDrawing({
        siteId: IDS.oak,
        title: 'Extra',
        revision: 'A',
        storagePath: `${IDS.company}/${IDS.oak}/extra.pdf`,
      }),
    /site_archived/,
  );
  const oak = await fixtureRepo.getSite(IDS.oak);
  assert.equal(oak?.archived_by, IDS.owner);
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  assert.equal((await fixtureRepo.companySitesPulse()).some((site) => site.site_id === IDS.oak), false);
  assert.equal(await fixtureRepo.getSite(IDS.oak), null);
  await assert.rejects(() => fixtureRepo.archiveSite(IDS.oak, true), /not_authorized/);
  await assert.rejects(() => fixtureRepo.archiveSite(IDS.oak, false), /not_authorized/);
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  assert.equal((await fixtureRepo.listAssignedSites()).some((site) => site.id === IDS.oak), false);
  assert.equal(await fixtureRepo.getSite(IDS.oak), null);
  await assert.rejects(() => fixtureRepo.createRequest({ siteId: IDS.oak, body: 'A section' }), /not_authorized/);
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.archiveSite(IDS.oak, false);
  assert.equal((await fixtureRepo.getSite(IDS.oak))?.archived_at, null);
  assert.equal((await fixtureRepo.getSite(IDS.oak))?.archived_by, null);
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  assert.equal((await fixtureRepo.listAssignedSites()).some((site) => site.id === IDS.oak), true);
  assert.equal((await fixtureRepo.getSite(IDS.oak))?.id, IDS.oak);
});

test('delete and archive controls are owner-only on web and native screens', () => {
  assert.equal(DELETE_DRAWING_CONFIRM, 'Are you sure? This removes it for everyone.');
  assert.match(ARCHIVE_SITE_CONFIRM, /no longer see it/);
  assert.match(RESTORE_SITE_CONFIRM, /working list/);

  const drawing = fs.readFileSync('app/(app)/sites/[siteId]/drawing/[drawingId].tsx', 'utf8');
  assert.match(drawing, /person\?\.role === 'owner' && drawing/);
  assert.match(drawing, /DELETE_DRAWING_CONFIRM/);
  assert.match(drawing, /label="Delete drawing"/);
  assert.match(drawing, /variant="danger"/);
  assert.match(drawing, /minHeight=\{48\}/);
  assert.match(drawing, /deleteDrawing/);

  const site = fs.readFileSync('app/(app)/sites/[siteId]/index.tsx', 'utf8');
  assert.match(site, /person\?\.role === 'owner'/);
  assert.match(site, /ARCHIVE_SITE_CONFIRM/);
  assert.match(site, /RESTORE_SITE_CONFIRM/);
  assert.match(site, /label=\{site\.archived_at \? 'Restore site' : 'Archive site'\}/);
  assert.match(site, /variant=\{site\.archived_at \? 'secondary' : 'danger'\}/);

  const home = fs.readFileSync('app/(app)/sites/index.tsx', 'utf8');
  assert.equal(home.includes('showArchived'), false);
  assert.equal(home.includes('archivedRows'), false);
  assert.match(home, /workingRows/);

  const company = fs.readFileSync('app/(app)/company.tsx', 'utf8');
  assert.match(company, /person\.role !== 'owner'/);
  assert.match(company, /Archived sites/);
  assert.match(company, /RESTORE_SITE_CONFIRM/);
  assert.match(company, /label="Restore"/);
  assert.match(company, /sweepDrawingOrphans/);

  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
  assert.match(repo, /rpc\('delete_drawing'/);
  assert.match(repo, /storage\.from\('drawings'\)\.remove/);
  assert.match(repo, /rpc\('clear_drawing_orphans'/);
  assert.match(repo, /rpc\(archived \? 'archive_site' : 'restore_site'/);
  assert.doesNotMatch(repo, /new Blob\(/);

  const migration = fs.readFileSync('supabase/migrations/20261023200000_delete_drawing_archive_site.sql', 'utf8');
  for (const name of [
    'private.site_is_active',
    'public.delete_drawing',
    'public.archive_site(p_site_id uuid)',
    'public.restore_site',
    'public.clear_drawing_orphans',
    'drawings_delete_owner',
    'drawings_storage_delete',
    'site_photos_insert',
    'archived_by',
    'drawing_file_orphans',
    'reject_archived_site_insert',
  ]) {
    assert.equal(migration.includes(name), true, name);
  }
  assert.match(migration, /private\.my_role\(\) = 'owner'/);
  assert.equal(migration.includes('create table public.drawing_versions'), false);
});
