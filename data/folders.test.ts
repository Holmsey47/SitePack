import assert from 'node:assert/strict';
import test from 'node:test';
import type { Drawing } from './types.ts';
import {
  FOLDER_PRESETS,
  LABEL_LIMIT,
  LEVEL_PRESETS,
  OTHER_FOLDER,
  limitLabel,
  compareFolderNames,
  displayFolder,
  displayLevel,
  drawingsInFolder,
  levelFilterLabels,
  packFolders,
  resolveFolder,
  resolveLevel,
} from './folders.ts';

function drawing(partial: Pick<Drawing, 'id' | 'title' | 'is_current' | 'folder'> & Partial<Drawing>): Drawing {
  return {
    site_id: 'site',
    sheet_number: null,
    revision: 'A',
    dated: '2026-09-10',
    supersedes_id: null,
    storage_path: 'path.pdf',
    file_size_bytes: 1,
    content_type: 'application/pdf',
    uploaded_by: null,
    created_at: '2026-09-10T00:00:00.000Z',
    updated_at: '2026-09-10T00:00:00.000Z',
    level: null,
    ...partial,
  };
}

test('blank or missing folder is Other', () => {
  assert.equal(displayFolder(null), OTHER_FOLDER);
  assert.equal(displayFolder(undefined), OTHER_FOLDER);
  assert.equal(displayFolder('   '), OTHER_FOLDER);
  assert.equal(displayFolder(' Ground floor '), 'Ground floor');
});

test('replace copies the previous folder only when folder is omitted', () => {
  assert.equal(resolveFolder(null, 'Ground floor'), 'Ground floor');
  assert.equal(resolveFolder(undefined, 'First floor'), 'First floor');
  assert.equal(resolveFolder('', 'Ground floor'), OTHER_FOLDER);
  assert.equal(resolveFolder('  Sections  ', 'Ground floor'), 'Sections');
  assert.equal(resolveFolder(null, null), OTHER_FOLDER);
});

test('site pack lists every folder that has a sheet, presets then custom then Other', () => {
  const rows = [
    drawing({ id: '1', title: 'Compound', is_current: true, folder: '' }),
    drawing({ id: '2', title: 'GA', is_current: true, folder: 'Ground floor' }),
    drawing({ id: '3', title: 'GA old', is_current: false, folder: 'Roof' }),
    drawing({ id: '4', title: 'FF', is_current: true, folder: 'First floor' }),
    drawing({ id: '5', title: 'Roof plan', is_current: true, folder: 'Roof' }),
    drawing({ id: '6', title: 'Elev', is_current: true, folder: 'Elevations' }),
    drawing({ id: '7', title: 'Lost', is_current: false, folder: 'Basement' }),
  ];
  const folders = packFolders(rows);
  assert.deepEqual(
    folders.map((folder) => folder.name),
    ['Elevations', 'Basement', 'First floor', 'Ground floor', 'Roof', 'Other']
  );
  assert.equal(folders.find((folder) => folder.name === 'Basement')?.archive, true);
  assert.equal(folders.find((folder) => folder.name === 'Roof')?.archive, false);
});

test('moving the new current sheet leaves the old folder as an archive', () => {
  const rows = [
    drawing({
      id: 'b',
      title: 'Ground Floor GA',
      sheet_number: 'A-101',
      revision: 'B',
      is_current: false,
      folder: 'Ground floor',
    }),
    drawing({
      id: 'c',
      title: 'Ground Floor GA',
      sheet_number: 'A-101',
      revision: 'C',
      is_current: false,
      folder: 'Ground floor',
    }),
    drawing({
      id: 'd',
      title: 'Ground Floor GA',
      sheet_number: 'A-101',
      revision: 'D',
      is_current: true,
      folder: 'First floor',
    }),
    drawing({
      id: 'ff',
      title: 'First Floor GA',
      sheet_number: 'A-102',
      revision: 'A',
      is_current: true,
      folder: 'First floor',
    }),
  ];
  const folders = packFolders(rows);
  const ground = folders.find((folder) => folder.name === 'Ground floor');
  const first = folders.find((folder) => folder.name === 'First floor');
  assert.equal(ground?.archive, true);
  assert.equal(ground?.currentCount, 0);
  assert.equal(ground?.supersededCount, 2);
  assert.equal(first?.archive, false);
  assert.equal(first?.currentCount, 2);

  const groundSheets = drawingsInFolder(rows, 'Ground floor');
  assert.deepEqual(groundSheets.current, []);
  assert.deepEqual(
    groundSheets.superseded.map((row) => row.revision),
    ['B', 'C']
  );
  assert.deepEqual(
    drawingsInFolder(rows, 'First floor').current.map((row) => row.revision),
    ['A', 'D']
  );
});

test('folder order puts type presets first and Other last', () => {
  assert.ok(compareFolderNames('Set out plans', 'Ceilings') < 0);
  assert.ok(compareFolderNames('Elevations', 'Basement') < 0);
  assert.ok(compareFolderNames('First floor', 'Ground floor') < 0);
  assert.ok(compareFolderNames('Roof', 'Other') < 0);
  assert.ok(compareFolderNames('Ground floor', 'Other') < 0);
});

test('upload presets are drawing types, and level chips are separate', () => {
  assert.deepEqual(
    [...FOLDER_PRESETS],
    ['Set out plans', 'Ceilings', 'Partitions', 'M&E', 'Elevations', 'Sections', 'Other']
  );
  assert.equal((FOLDER_PRESETS as readonly string[]).includes('Ground floor'), false);
  assert.equal((FOLDER_PRESETS as readonly string[]).includes('First floor'), false);
  assert.equal((FOLDER_PRESETS as readonly string[]).includes('Second floor'), false);
  assert.deepEqual([...LEVEL_PRESETS], ['Basement', 'Ground', 'L1', 'L2', 'L3', 'L4', 'Roof']);
  assert.equal(LABEL_LIMIT, 40);
  for (const name of [...FOLDER_PRESETS, ...LEVEL_PRESETS, 'Ground floor', 'First floor', 'Second floor']) {
    assert.ok(Array.from(name).length <= LABEL_LIMIT, name);
  }
  assert.equal(limitLabel('L2'), 'L2');
  assert.equal(limitLabel('a'.repeat(40)).length, 40);
  assert.equal(limitLabel('a'.repeat(41)), 'a'.repeat(40));
  assert.equal(Array.from(limitLabel('é'.repeat(41))).length, 40);
});

test('replace copies the previous level only when level is omitted', () => {
  assert.equal(resolveLevel(null, 'L2'), 'L2');
  assert.equal(resolveLevel(undefined, ' Ground '), 'Ground');
  assert.equal(resolveLevel('', 'L2'), null);
  assert.equal(resolveLevel('   ', 'L2'), null);
  assert.equal(resolveLevel('  L3 ', 'L2'), 'L3');
  assert.equal(resolveLevel(null, null), null);
  assert.equal(resolveLevel(null, '   '), null);
  assert.equal(displayLevel(' Roof '), 'Roof');
});

test('level filter row is hidden unless current sheets have two or more levels', () => {
  const sheet = (id: string, level: string | null, isCurrent = true) =>
    drawing({ id, title: id, is_current: isCurrent, folder: 'Set out plans', level });

  assert.equal(levelFilterLabels([]), null);
  assert.equal(levelFilterLabels([sheet('a', null)]), null);
  assert.equal(levelFilterLabels([sheet('a', '  ')]), null);
  assert.equal(levelFilterLabels([sheet('a', 'L2')]), null);
  assert.equal(levelFilterLabels([sheet('a', 'L2'), sheet('b', 'L2')]), null);
  assert.equal(levelFilterLabels([sheet('a', 'L2'), sheet('old', 'Ground', false)]), null);
  assert.deepEqual(
    levelFilterLabels([sheet('a', 'L2'), sheet('b', ' Ground '), sheet('c', 'L2'), sheet('old', 'Roof', false)]),
    ['Ground', 'L2']
  );
  assert.deepEqual(
    levelFilterLabels([sheet('a', 'Mezz'), sheet('b', 'Roof'), sheet('c', 'L2'), sheet('d', 'Basement')]),
    ['Basement', 'L2', 'Roof', 'Mezz']
  );
  assert.deepEqual(levelFilterLabels([sheet('a', 'Ground'), sheet('b', 'L1'), sheet('c', null)]), ['Ground', 'L1']);
});
