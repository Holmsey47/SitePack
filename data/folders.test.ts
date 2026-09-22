import assert from 'node:assert/strict';
import test from 'node:test';
import type { Drawing } from './types.ts';
import {
  OTHER_FOLDER,
  compareFolderNames,
  displayFolder,
  drawingsInFolder,
  foldersWithCurrentSheets,
  resolveFolder,
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

test('site pack lists only folders that have a current sheet, presets then custom then Other', () => {
  const rows = [
    drawing({ id: '1', title: 'Compound', is_current: true, folder: '' }),
    drawing({ id: '2', title: 'GA', is_current: true, folder: 'Ground floor' }),
    drawing({ id: '3', title: 'GA old', is_current: false, folder: 'Roof' }),
    drawing({ id: '4', title: 'FF', is_current: true, folder: 'First floor' }),
    drawing({ id: '5', title: 'Roof plan', is_current: true, folder: 'Roof' }),
    drawing({ id: '6', title: 'Elev', is_current: true, folder: 'Elevations' }),
  ];
  assert.deepEqual(
    foldersWithCurrentSheets(rows).map((folder) => folder.name),
    ['Ground floor', 'First floor', 'Elevations', 'Roof', 'Other']
  );
});

test('superseded sheets stay in their folder and do not create a folder on their own', () => {
  const rows = [
    drawing({
      id: 'c',
      title: 'Ground Floor GA',
      sheet_number: 'A-101',
      revision: 'C',
      is_current: true,
      folder: 'Ground floor',
    }),
    drawing({
      id: 'b',
      title: 'Ground Floor GA',
      sheet_number: 'A-101',
      revision: 'B',
      is_current: false,
      folder: 'Ground floor',
    }),
    drawing({ id: 'old', title: 'Lost', is_current: false, folder: 'Basement' }),
  ];
  assert.deepEqual(
    foldersWithCurrentSheets(rows).map((folder) => folder.name),
    ['Ground floor']
  );
  const ground = drawingsInFolder(rows, 'Ground floor');
  assert.deepEqual(
    ground.current.map((row) => row.revision),
    ['C']
  );
  assert.deepEqual(
    ground.superseded.map((row) => row.revision),
    ['B']
  );
  assert.equal(drawingsInFolder(rows, 'Basement').current.length, 0);
});

test('folder order puts Other last', () => {
  assert.ok(compareFolderNames('Ground floor', 'Other') < 0);
  assert.ok(compareFolderNames('Roof', 'Other') < 0);
  assert.ok(compareFolderNames('Ground floor', 'First floor') < 0);
});
