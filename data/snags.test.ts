import assert from 'node:assert/strict';
import test from 'node:test';
import { IDS, SEED_PASSWORD } from './ids.ts';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { filterSnags, snagLevels, snagNumber } from './snags.ts';

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

test('a lad marks a snag fixed and a contracts manager signs it off', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  const open = (await fixtureRepo.listSnags(IDS.oak)).rows.find((row) => row.status === 'Open');
  assert.ok(open);
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
  await assert.rejects(() => fixtureRepo.signOffSnagAsManager(open.snag_id, new Date().toISOString()), /not_authorized/);

  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  const signedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await fixtureRepo.signOffSnagAsManager(open.snag_id, signedAt);
  const signed = await fixtureRepo.getSnag(open.snag_id);
  assert.equal(signed?.status, 'Signed off');
  assert.equal(signed?.signature?.kind, 'manager');
  assert.equal(signed?.signature?.signer_name, 'Priya Shah');
  assert.equal(signed?.signature?.signer_role, 'Contracts manager');
  assert.equal(signed?.signature?.signer_company, 'Ashfield Finishes');
  assert.equal(signed?.signature?.signed_at, new Date(signedAt).toISOString());
  assert.ok(signed?.signature?.signed_received_at);
  await assert.rejects(() => fixtureRepo.fixSnag(open.snag_id, new Date().toISOString(), [
    { storagePath: `${IDS.company}/${IDS.oak}/snags/again.jpg`, contentType: 'image/jpeg', fileSizeBytes: 10 },
  ]), /snag_locked/);
});
