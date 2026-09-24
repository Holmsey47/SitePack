import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { bytesToBase64 } from './base64.ts';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import { newId } from './newId.ts';
import { sheetViewHtml } from '../lib/sheetHtml.ts';
import {
  PACK_DIRECTORY_CREATE,
  PACK_DOWNLOAD_ERROR,
  archivedRows,
  contractsManagerLine,
  ensurePackDirectory,
  inviteSiteIds,
  occupationLine,
  operativesLine,
  requestSentLine,
  revisionCurrentLine,
  workingRows,
} from './walk.ts';

test('phone walk copy and ids', () => {
  assert.equal(occupationLine('operative', null), 'Operative');
  assert.equal(occupationLine('operative', '  '), 'Operative');
  assert.equal(occupationLine('operative', 'site supervisor'), 'Operative · site supervisor');
  assert.equal(occupationLine('cm', null), 'Contracts manager');
  assert.equal(contractsManagerLine([]), 'Contracts manager: none');
  assert.equal(contractsManagerLine(['John Smith', 'Priya Shah']), 'Contracts manager: John Smith, Priya Shah');
  assert.equal(operativesLine(4), 'Operatives: 4 assigned.');
  assert.equal(requestSentLine([]), 'Request sent.');
  assert.equal(requestSentLine(['Priya Shah']), 'Request sent to Priya Shah.');
  assert.equal(revisionCurrentLine('D'), 'Rev D is current.');
  assert.equal(PACK_DOWNLOAD_ERROR, 'Could not download the pack.');
  assert.deepEqual(inviteSiteIds({ siteId: 'oak', siteIds: ['oak', 'yard'] }), ['oak', 'yard']);
  assert.match(newId(), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(bytesToBase64(new Uint8Array([104, 105])), 'aGk=');

  const calls: unknown[] = [];
  ensurePackDirectory({
    create(options) {
      calls.push(options);
    },
  });
  assert.deepEqual(calls, [PACK_DIRECTORY_CREATE]);
  assert.equal(PACK_DIRECTORY_CREATE.intermediates, true);
  assert.equal(PACK_DIRECTORY_CREATE.idempotent, true);

  const html = sheetViewHtml('QQ==', 'var pdfjsLib = {};', 'var pdfjsWorker = {};');
  assert.match(html, /getDocument/);
  assert.match(html, /QQ==/);
  assert.doesNotMatch(html, /createObjectURL|new Blob|new Worker|workerSrc|cdnjs/);
  const frame = fs.readFileSync('components/drawing-frame.tsx', 'utf8');
  const webFrame = fs.readFileSync('components/drawing-frame.web.tsx', 'utf8');
  assert.equal(frame.includes('cdnjs'), false);
  assert.equal(frame.includes('https://'), false);
  assert.match(fs.readFileSync('assets/pdfjs/pdf.min.pdfjs', 'utf8'), /pdfjsLib/);
  assert.match(fs.readFileSync('assets/pdfjs/pdf.worker.min.pdfjs', 'utf8'), /pdfjsWorker/);
  assert.equal(frame.includes('createObjectURL'), false);
  assert.match(frame, /source=\{\{ html \}\}/);
  assert.equal(webFrame.includes('src: uri'), false);
  assert.match(webFrame, /srcDoc: html/);
  const namesMigration = fs.readFileSync('supabase/migrations/20260924120000_contracts_manager_names.sql', 'utf8');
  assert.match(namesMigration, /private\.can_access_site\(p_site_id\)/);
  assert.match(namesMigration, /p\.role = 'cm'/);
  assert.equal(namesMigration.includes('email'), false);
  const requestScreen = fs.readFileSync('app/(app)/sites/[siteId]/request.tsx', 'utf8');
  assert.match(requestScreen, /contractsManagerNames/);
  assert.equal(requestScreen.includes('listAssignments'), false);
  const inbox = fs.readFileSync('app/(app)/requests/index.tsx', 'utf8');
  assert.equal(inbox.includes('setRows([])'), false);
  assert.match(inbox, /Could not load requests\./);
  const drawing = fs.readFileSync('app/(app)/sites/[siteId]/drawing/[drawingId].tsx', 'utf8');
  assert.match(drawing, /setSaveError\('Could not save the sheet\.'\)/);
  assert.doesNotMatch(drawing, /setError\('Could not save the sheet\.'\)/);
  const sites = fs.readFileSync('app/(app)/sites/index.tsx', 'utf8');
  assert.match(sites, /Could not load sites\./);
  assert.equal(sites.includes('err.message'), false);
  const pack = fs.readFileSync('app/(app)/sites/[siteId]/index.tsx', 'utf8');
  assert.match(pack, /Could not load the pack\./);
  assert.match(pack, /This site is not assigned to you\./);
  const request = fs.readFileSync('app/(app)/requests/[requestId].tsx', 'utf8');
  assert.match(request, /label="Attach drawing \/ upload" variant="secondary"/);
  assert.match(request, /Could not load the request\./);
  const people = fs.readFileSync('app/(app)/people.tsx', 'utf8');
  assert.match(people, /Remove from \$\{site\.name\}/);

  for (const path of [
    'app/(app)/sites/[siteId]/upload.tsx',
    'data/supabaseRepo.ts',
    'data/fixtureRepo.ts',
  ]) {
    assert.equal(fs.readFileSync(path, 'utf8').includes('crypto.randomUUID'), false);
  }

  const migration = fs.readFileSync('supabase/migrations/20260923230000_phone_walk.sql', 'utf8');
  assert.match(migration, /p.role = 'cm'/);
  assert.match(migration, /p.role = 'operative'/);
  assert.match(migration, /private.my_role\(\) is distinct from 'owner'/);
  assert.match(migration, /grant delete on table public.drawing_requests/);
});

test('site card, archive, invite sites, and finished requests', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const oak = (await fixtureRepo.companySitesPulse()).find((site) => site.site_id === IDS.oak);
  assert.ok(oak);
  assert.deepEqual(oak.contracts_manager_names, ['Priya Shah']);
  assert.equal(oak.operative_count, 2);
  assert.equal(oak.contracts_manager_names.includes('Jordan Hale'), false);
  assert.equal(workingRows([oak]).length, 1);

  await fixtureRepo.archiveSite(IDS.oak, true);
  const archived = (await fixtureRepo.companySitesPulse()).find((site) => site.site_id === IDS.oak);
  assert.ok(archived?.archived_at);
  assert.equal(archivedRows([archived]).length, 1);
  assert.equal(workingRows([archived]).length, 0);
  assert.equal((await fixtureRepo.getSite(IDS.oak))?.id, IDS.oak);
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  await assert.rejects(() => fixtureRepo.archiveSite(IDS.warehouse, true), /not_authorized/);
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.archiveSite(IDS.oak, false);
  await fixtureRepo.invitePerson({
    email: 'lee@sitepack.test',
    displayName: 'Lee Stone',
    role: 'operative',
    trade: 'quantity surveyor',
    siteIds: [IDS.oak, IDS.riverside],
  });
  const lee = (await fixtureRepo.listCompanyPeople()).find((person) => person.email === 'lee@sitepack.test');
  assert.equal(lee?.role, 'operative');
  assert.equal(lee?.trade, 'quantity surveyor');
  assert.equal((await fixtureRepo.listAssignments(IDS.oak)).some((row) => row.person_id === lee?.id), true);
  assert.equal((await fixtureRepo.listAssignments(IDS.riverside)).some((row) => row.person_id === lee?.id), true);

  const open = (await fixtureRepo.listInboxRequests()).find((row) => row.id === IDS.openRequest);
  assert.ok(open);
  await fixtureRepo.updateRequest(IDS.openRequest, { status: 'Closed' });
  assert.equal((await fixtureRepo.listInboxRequests()).some((row) => row.id === IDS.openRequest), false);
  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.deleteRequest(IDS.openRequest);
  assert.equal(await fixtureRepo.getRequest(IDS.openRequest), null);
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  assert.deepEqual(await fixtureRepo.contractsManagerNames(IDS.oak), ['Priya Shah']);
  assert.deepEqual(await fixtureRepo.contractsManagerNames(IDS.riverside), []);
});
