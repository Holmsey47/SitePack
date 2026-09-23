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

  const html = sheetViewHtml('QQ==', 'Qg==', 'Qw==');
  assert.match(html, /getDocument/);
  assert.doesNotMatch(html, /source:\s*\{\s*uri/);
  assert.match(html, /QQ==/);

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
});
