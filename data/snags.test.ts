import assert from 'node:assert/strict';
import test from 'node:test';
import { IDS, SEED_PASSWORD } from './ids.ts';
import { editSnagSignoffForTests, fixtureRepo, resetFixtureStore, snagSignoffCountForTests } from './fixtureRepo.ts';
import { newId } from './newId.ts';
import {
  MARK_FIXED_ALREADY,
  MARK_FIXED_NEEDS_PHOTO,
  MARK_FIXED_NOT_ON_SITE,
  MARK_FIXED_PHOTO_COUNT,
  MARK_FIXED_ROLE,
  MARK_FIXED_SAVING,
  MARK_FIXED_SIGN_IN,
  MARK_FIXED_SIGN_OFF_PENDING,
  MARK_FIXED_SIGNED_OFF,
  filterSnags,
  markFixedDisabledReason,
  snagError,
  snagLevels,
  snagNumber,
} from './snags.ts';
import { snagConfirmation } from '../lib/snagWording.ts';

test('snag list filters by status and level', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const oak = await fixtureRepo.listSnags(IDS.oak);
  assert.equal(oak.rows.length, 10);
  assert.equal(snagNumber(oak.rows[0]?.snag_seq ?? 0), 'S-1');
  assert.deepEqual(snagLevels(oak.rows), ['First', 'Ground', 'Second']);
  assert.equal(filterSnags(oak.rows, 'Open', 'Ground').length, 2);
  assert.equal(filterSnags(oak.rows, 'Signed off', 'All').length, 3);
  assert.equal(filterSnags(oak.rows, 'Fixed', 'First').length, 1);
  await assert.rejects(() => fixtureRepo.listSnags(IDS.warehouse), /not_authorized/);
  assert.equal(await fixtureRepo.getSnag('missing'), null);
});

test('trade suggestions come from people on the site and a snag can use free text', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const labels = await fixtureRepo.snagTradeLabels(IDS.oak);
  assert.deepEqual(labels, ['contracts', 'dryliner', 'labourer']);
  const raisedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const created = await fixtureRepo.createSnag({
    snagId: newId(),
    siteId: IDS.oak,
    note: 'Conduit not clipped',
    levelArea: 'Roof',
    tradeLabel: 'electrician',
    raisedAt,
    photos: [
      {
        storagePath: `${IDS.company}/${IDS.oak}/snags/new.jpg`,
        contentType: 'image/jpeg',
        fileSizeBytes: 1200,
      },
    ],
  });
  const detail = await fixtureRepo.getSnag(created.snagId);
  assert.equal(detail?.trade_label, 'electrician');
  assert.equal(detail?.raised_at, new Date(raisedAt).toISOString());
  assert.ok(detail?.raised_received_at);
  assert.notEqual(detail?.raised_at, detail?.raised_received_at);
  await assert.rejects(
    () =>
      fixtureRepo.createSnag({
        snagId: newId(),
        siteId: IDS.oak,
        note: 'Too old',
        tradeLabel: 'dryliner',
        raisedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
        photos: [
          {
            storagePath: `${IDS.company}/${IDS.oak}/snags/old.jpg`,
            contentType: 'image/jpeg',
            fileSizeBytes: 100,
          },
        ],
      }),
    /invalid_time/
  );
});

function shownIds(rows: Array<{ snag_id: string; status: string }>) {
  return {
    coveredIds: rows.filter((row) => row.status === 'Fixed').map((row) => row.snag_id),
    outstandingIds: rows.filter((row) => row.status === 'Open').map((row) => row.snag_id),
  };
}

test('a lad marks a snag fixed and a contracts manager signs off only the ones put right', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const before = await fixtureRepo.listSnags(IDS.oak);
  const open = before.rows.find((row) => row.status === 'Open');
  assert.ok(open);
  const openCount = before.rows.filter((row) => row.status === 'Open').length;
  const fixedCount = before.rows.filter((row) => row.status === 'Fixed').length;
  await assert.rejects(
    () => fixtureRepo.fixSnag(open.snag_id, new Date().toISOString(), []),
    /photo_count/
  );
  const fixedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await fixtureRepo.fixSnag(open.snag_id, fixedAt, [
    {
      storagePath: `${IDS.company}/${IDS.oak}/snags/after.jpg`,
      contentType: 'image/jpeg',
      fileSizeBytes: 900,
    },
  ]);
  const fixed = await fixtureRepo.getSnag(open.snag_id);
  assert.equal(fixed?.status, 'Fixed');
  assert.equal(fixed?.photos.filter((photo) => photo.kind === 'after').length, 1);
  assert.equal(fixed?.fixed_at, new Date(fixedAt).toISOString());
  const sameId = newId();
  const beforeSign = shownIds((await fixtureRepo.listSnags(IDS.oak)).rows);
  await assert.rejects(
    () =>
      fixtureRepo.signOffSnagsInternal({
        signoffId: sameId,
        siteId: IDS.oak,
        signedAt: new Date().toISOString(),
        company: 'Northbuild',
        ...beforeSign,
      }),
    /not_authorized/
  );

  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  const signedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const first = await fixtureRepo.signOffSnagsInternal({
    signoffId: sameId,
    siteId: IDS.oak,
    signedAt,
    company: 'Northbuild',
    ...shownIds((await fixtureRepo.listSnags(IDS.oak)).rows),
  });
  assert.equal(first.confirmation_text, snagConfirmation('Northbuild', 'internal', first.covered.length));
  assert.equal(first.signer_company, 'Northbuild');
  assert.equal(first.covered.length, fixedCount + 1);
  assert.equal(first.outstanding.length, openCount - 1);
  assert.equal(first.outstanding.some((row) => row.snag_id === open.snag_id), false);
  assert.ok(first.covered.some((row) => row.snag_id === open.snag_id && row.status === 'Fixed' && (row.photo_paths?.length ?? 0) > 0));
  const signed = await fixtureRepo.getSnag(open.snag_id);
  assert.equal(signed?.status, 'Signed off');
  assert.equal(signed?.signature?.kind, 'internal');
  assert.equal(signed?.signature?.confirmation_text, first.confirmation_text);
  assert.equal(signed?.signature?.signer_name, 'Priya Shah');
  assert.equal(signed?.signature?.signer_role, 'Contracts manager');
  assert.equal(signed?.signature?.signed_at, new Date(signedAt).toISOString());
  assert.throws(() => editSnagSignoffForTests(sameId), /closed/);
  const beforeSecond = snagSignoffCountForTests();
  const stillOpen = (await fixtureRepo.listSnags(IDS.oak)).rows.find((row) => row.status === 'Open');
  assert.ok(stillOpen);
  assert.equal(first.outstanding.some((row) => row.snag_id === stillOpen.snag_id), true);
  await fixtureRepo.fixSnag(stillOpen.snag_id, new Date(Date.now() - 5 * 60 * 1000).toISOString(), [
    {
      storagePath: `${IDS.company}/${IDS.oak}/snags/later.jpg`,
      contentType: 'image/jpeg',
      fileSizeBytes: 800,
    },
  ]);
  const second = await fixtureRepo.signOffSnagsInternal({
    signoffId: newId(),
    siteId: IDS.oak,
    signedAt: new Date().toISOString(),
    company: 'Northbuild',
    ...shownIds((await fixtureRepo.listSnags(IDS.oak)).rows),
  });
  assert.equal(snagSignoffCountForTests(), beforeSecond + 1);
  assert.notEqual(second.signoff_id, first.signoff_id);
  assert.equal(second.covered.length, 1);
  assert.equal(second.covered[0]?.snag_id, stillOpen.snag_id);
  assert.equal(second.outstanding.length, first.outstanding.length - 1);
  assert.equal(first.outstanding.length, openCount - 1);
  await assert.rejects(
    () =>
      fixtureRepo.fixSnag(open.snag_id, new Date().toISOString(), [
        { storagePath: `${IDS.company}/${IDS.oak}/snags/again.jpg`, contentType: 'image/jpeg', fileSizeBytes: 10 },
      ]),
    /snag_locked/
  );
});

test('creating the same snag id twice keeps one row', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const snagId = newId();
  const input = {
    snagId,
    siteId: IDS.oak,
    note: 'Same snag',
    tradeLabel: 'dryliner',
    raisedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    photos: [
      {
        storagePath: `${IDS.company}/${IDS.oak}/snags/same.jpg`,
        contentType: 'image/jpeg',
        fileSizeBytes: 400,
      },
    ],
  };
  const first = await fixtureRepo.createSnag(input);
  const second = await fixtureRepo.createSnag({
    ...input,
    note: 'Different note',
    photos: [
      {
        storagePath: `${IDS.company}/${IDS.oak}/snags/other.jpg`,
        contentType: 'image/jpeg',
        fileSizeBytes: 400,
      },
    ],
  });
  assert.equal(second.snagId, first.snagId);
  assert.equal(second.snagSeq, first.snagSeq);
  const detail = await fixtureRepo.getSnag(snagId);
  assert.equal(detail?.note, 'Same snag');
  assert.equal(detail?.photos.length, 1);
  assert.equal(second.alreadyExisted, true);
  assert.deepEqual(second.photoPaths, [`${IDS.company}/${IDS.oak}/snags/same.jpg`]);
});

test('a retry of the same fix succeeds and a later fix is locked', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const open = (await fixtureRepo.listSnags(IDS.oak)).rows.find((row) => row.status === 'Open');
  assert.ok(open);
  const fixId = newId();
  const photos = [
    {
      storagePath: `${IDS.company}/${IDS.oak}/snags/after.jpg`,
      contentType: 'image/jpeg',
      fileSizeBytes: 900,
    },
  ];
  const fixedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const first = await fixtureRepo.fixSnag(open.snag_id, fixedAt, photos, fixId);
  assert.equal(first.alreadyFixed, false);
  const retry = await fixtureRepo.fixSnag(open.snag_id, new Date().toISOString(), photos, newId());
  assert.equal(retry.alreadyFixed, true);
  const sameClient = await fixtureRepo.fixSnag(
    open.snag_id,
    new Date().toISOString(),
    [{ storagePath: `${IDS.company}/${IDS.oak}/snags/other.jpg`, contentType: 'image/jpeg', fileSizeBytes: 20 }],
    fixId
  );
  assert.equal(sameClient.alreadyFixed, true);
  const detail = await fixtureRepo.getSnag(open.snag_id);
  assert.equal(detail?.photos.filter((photo) => photo.kind === 'after').length, 1);
  assert.equal(detail?.fixed_at, new Date(fixedAt).toISOString());
  await assert.rejects(
    () =>
      fixtureRepo.fixSnag(
        open.snag_id,
        new Date().toISOString(),
        [{ storagePath: `${IDS.company}/${IDS.oak}/snags/different.jpg`, contentType: 'image/jpeg', fileSizeBytes: 20 }],
        newId()
      ),
    /snag_locked/
  );
});

test('a snag marked fixed after the list was shown is refused', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  const before = shownIds((await fixtureRepo.listSnags(IDS.oak)).rows);
  const moving = before.outstandingIds[0];
  assert.ok(moving);
  await fixtureRepo.fixSnag(moving, new Date(Date.now() - 20 * 60 * 1000).toISOString(), [
    {
      storagePath: `${IDS.company}/${IDS.oak}/snags/late.jpg`,
      contentType: 'image/jpeg',
      fileSizeBytes: 800,
    },
  ]);
  await assert.rejects(
    () =>
      fixtureRepo.signOffSnagsInternal({
        signoffId: newId(),
        siteId: IDS.oak,
        signedAt: new Date().toISOString(),
        company: 'Ashfield Finishes',
        coveredIds: before.coveredIds,
        outstandingIds: before.outstandingIds,
      }),
    /snag_list_changed/
  );
  const signed = await fixtureRepo.signOffSnagsInternal({
    signoffId: newId(),
    siteId: IDS.oak,
    signedAt: new Date().toISOString(),
    company: 'Ashfield Finishes',
    ...shownIds((await fixtureRepo.listSnags(IDS.oak)).rows),
  });
  assert.equal(signed.covered.some((row) => row.snag_id === moving), true);
  assert.equal(signed.outstanding.some((row) => row.snag_id === moving), false);
});

test('mark fixed names every reason it is disabled', () => {
  const ready = {
    signedIn: true,
    role: 'owner' as const,
    assigned: true,
    status: 'Open' as const,
    afterPhotoCount: 1,
    saving: false,
    signOffPending: false,
  };
  assert.equal(markFixedDisabledReason(ready), null);
  assert.equal(markFixedDisabledReason({ ...ready, role: 'cm' }), null);
  assert.equal(markFixedDisabledReason({ ...ready, role: 'operative' }), null);
  assert.equal(markFixedDisabledReason({ ...ready, afterPhotoCount: 10 }), null);
  assert.equal(markFixedDisabledReason({ ...ready, role: 'operative', afterPhotoCount: 0 }), MARK_FIXED_NEEDS_PHOTO);
  assert.equal(markFixedDisabledReason({ ...ready, afterPhotoCount: 0 }), MARK_FIXED_NEEDS_PHOTO);
  assert.equal(markFixedDisabledReason({ ...ready, afterPhotoCount: 0 }), snagError('after_photo_required'));
  assert.equal(markFixedDisabledReason({ ...ready, afterPhotoCount: 11 }), MARK_FIXED_PHOTO_COUNT);
  assert.equal(markFixedDisabledReason({ ...ready, afterPhotoCount: 11 }), snagError('photo_count'));
  assert.equal(markFixedDisabledReason({ ...ready, saving: true }), MARK_FIXED_SAVING);
  assert.equal(markFixedDisabledReason({ ...ready, saving: true, afterPhotoCount: 0 }), MARK_FIXED_SAVING);
  assert.equal(markFixedDisabledReason({ ...ready, signedIn: false, role: null }), MARK_FIXED_SIGN_IN);
  assert.equal(markFixedDisabledReason({ ...ready, role: null }), MARK_FIXED_ROLE);
  assert.equal(markFixedDisabledReason({ ...ready, assigned: false }), MARK_FIXED_NOT_ON_SITE);
  assert.equal(markFixedDisabledReason({ ...ready, status: 'Signed off' }), MARK_FIXED_SIGNED_OFF);
  assert.equal(markFixedDisabledReason({ ...ready, status: 'Signed off' }), snagError('snag_locked'));
  assert.equal(markFixedDisabledReason({ ...ready, status: 'Fixed', signOffPending: true }), MARK_FIXED_SIGN_OFF_PENDING);
  assert.equal(markFixedDisabledReason({ ...ready, status: 'Fixed' }), MARK_FIXED_ALREADY);
  assert.equal(
    markFixedDisabledReason({ ...ready, status: 'Open', signOffPending: true, afterPhotoCount: 0 }),
    MARK_FIXED_NEEDS_PHOTO
  );
});
