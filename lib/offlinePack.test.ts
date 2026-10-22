import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changedSheetCount,
  downloadsOnWifi,
  drawingCopyIsStale,
  drawingIdsToDelete,
  packIsStale,
  packNeedsDownload,
  phoneCopyOutOfDateLine,
  phoneSheetRows,
  siteIdsFromPackKeys,
  siteIdsToDrop,
} from './offlinePack.ts';

const downloadedAt = '2026-10-01T12:00:00.000Z';

test('superseded drawing ids are the ones no longer current', () => {
  assert.deepEqual(drawingIdsToDelete(['a', 'b', 'c'], ['b', 'd']), ['a', 'c']);
  assert.deepEqual(drawingIdsToDelete(['a', 'a', ''], ['a']), []);
  assert.deepEqual(drawingIdsToDelete([], ['a']), []);
});

test('removal from a site drops that site cache and leaves the rest', () => {
  assert.deepEqual(siteIdsToDrop(['oak', 'yard', 'oak'], ['oak']), ['yard']);
  assert.deepEqual(siteIdsToDrop(['oak'], ['oak', 'yard']), []);
  assert.deepEqual(
    siteIdsFromPackKeys(['sitepack.offline.sites', 'sitepack.offline.pack.oak', 'sitepack.offline.pack.']),
    ['oak']
  );
});

test('current revisions download on Wi-Fi only, and a matching pack is not fetched again', () => {
  assert.equal(downloadsOnWifi('WIFI'), true);
  assert.equal(downloadsOnWifi('CELLULAR'), false);
  assert.equal(downloadsOnWifi('NONE'), false);
  assert.equal(downloadsOnWifi(undefined), false);

  const current = [
    { drawing_id: 'a', revision: 'C' },
    { drawing_id: 'b', revision: 'A' },
  ];
  assert.equal(packNeedsDownload(null, current), true);
  assert.equal(
    packNeedsDownload(
      {
        items: [
          { drawingId: 'a', revision: 'C' },
          { drawingId: 'b', revision: 'A' },
        ],
      },
      current
    ),
    false
  );
  assert.equal(
    packNeedsDownload(
      {
        items: [
          { drawingId: 'a', revision: 'B' },
          { drawingId: 'b', revision: 'A' },
        ],
      },
      current
    ),
    true
  );
  assert.equal(packNeedsDownload({ items: [{ drawingId: 'old', revision: 'A' }] }, []), true);
});

test('a stale badge shows when the cached revision or the site update is newer than the download', () => {
  const meta = {
    downloadedAt,
    items: [{ drawingId: 'a', revision: 'B' }],
  };
  assert.equal(packIsStale(null, { updatedAt: '2026-10-02T00:00:00.000Z' }), false);
  assert.equal(packIsStale(meta, { updatedAt: '2026-09-01T00:00:00.000Z' }), false);
  assert.equal(packIsStale(meta, { updatedAt: '2026-10-02T00:00:00.000Z' }), true);
  assert.equal(
    packIsStale(meta, {
      updatedAt: '2026-10-02T00:00:00.000Z',
      current: [{ drawingId: 'a', revision: 'B' }],
    }),
    false
  );
  assert.equal(
    packIsStale(meta, {
      current: [{ drawingId: 'a', revision: 'C' }],
    }),
    true
  );
  assert.equal(drawingCopyIsStale(meta, 'a', { revision: 'C' }, downloadedAt), true);
  assert.equal(drawingCopyIsStale(meta, 'a', { revision: 'B' }, '2026-10-02T00:00:00.000Z'), false);
  assert.equal(drawingCopyIsStale(meta, 'a', null, '2026-10-02T00:00:00.000Z'), true);
  assert.equal(drawingCopyIsStale(meta, 'missing', null, '2026-10-02T00:00:00.000Z'), false);
});

test('an out of date phone copy names the changed sheets and the last sync day', () => {
  const phone = [
    { drawingId: 'ground', title: 'Ground Floor GA', revision: 'C' },
    { drawingId: 'first', title: 'First Floor GA', revision: 'A' },
  ];
  const current = [
    { drawingId: 'ground', title: 'Ground Floor GA', revision: 'D' },
    { drawingId: 'first', title: 'First Floor GA', revision: 'A' },
  ];
  const rows = phoneSheetRows(phone, current);
  assert.equal(changedSheetCount(rows), 1);
  assert.equal(rows[0].changedLabel, 'Ground Floor GA · new Rev D, not on phone');
  assert.equal(rows[1].changedLabel, null);
  assert.equal(
    phoneCopyOutOfDateLine(1, '2026-10-22T12:00:00.000Z'),
    'Phone copy is out of date. 1 sheet changed since 22 Oct.'
  );
  assert.equal(
    phoneCopyOutOfDateLine(2, '2026-10-22T12:00:00.000Z'),
    'Phone copy is out of date. 2 sheets changed since 22 Oct.'
  );
});
