import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { commitDrawingFile } from './drawingUpload.ts';

test('a refused drawing insert deletes the uploaded object and a success leaves it', async () => {
  const bucket = new Set<string>();
  const removed: string[] = [];
  await assert.rejects(
    () =>
      commitDrawingFile({
        upload: async () => {
          bucket.add('co/site/drawing.pdf');
          return { storagePath: 'co/site/drawing.pdf', fileSizeBytes: 4 };
        },
        insert: async () => {
          throw new Error('not_authorized');
        },
        remove: async (storagePath) => {
          removed.push(storagePath);
          bucket.delete(storagePath);
        },
      }),
    /not_authorized/
  );
  assert.deepEqual(removed, ['co/site/drawing.pdf']);
  assert.equal(bucket.size, 0);

  let removeCalls = 0;
  const saved = await commitDrawingFile({
    upload: async () => {
      bucket.add('co/site/kept.pdf');
      return { storagePath: 'co/site/kept.pdf', fileSizeBytes: 4 };
    },
    insert: async (uploaded) => uploaded.storagePath,
    remove: async () => {
      removeCalls += 1;
    },
  });
  assert.equal(saved, 'co/site/kept.pdf');
  assert.equal(removeCalls, 0);
  assert.equal(bucket.has('co/site/kept.pdf'), true);

  bucket.clear();
  await assert.rejects(
    () =>
      commitDrawingFile({
        upload: async () => {
          throw new Error('upload failed');
        },
        insert: async () => 'should-not-run',
        remove: async (storagePath) => {
          bucket.add(`removed:${storagePath}`);
        },
      }),
    /upload failed/
  );
  assert.equal(bucket.size, 0);
});

test('a delete that fails after a refused insert is not reported as a clean pack', async () => {
  await assert.rejects(
    () =>
      commitDrawingFile({
        upload: async () => ({ storagePath: 'co/site/stuck.pdf' }),
        insert: async () => {
          throw new Error('not_authorized');
        },
        remove: async () => {
          throw new Error('storage_orphan');
        },
      }),
    /not_authorized \(the file was not removed: storage_orphan\)/
  );
});

test('the upload screen commits through the helper and the migration does not allow delete queries', () => {
  const screen = fs.readFileSync('app/(app)/sites/[siteId]/upload.tsx', 'utf8');
  const helper = fs.readFileSync('lib/drawingUpload.ts', 'utf8');
  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
  const migration = fs.readFileSync('supabase/migrations/20261030141500_drawings_storage_delete_own_recent.sql', 'utf8');
  assert.match(screen, /commitDrawingFile/);
  assert.match(screen, /removeUncommittedDrawing/);
  assert.match(helper, /await deps\.upload\(\)/);
  assert.match(helper, /await deps\.insert\(uploaded\)/);
  assert.match(helper, /await deps\.remove\(uploaded\.storagePath\)/);
  assert.match(repo, /removeUncommittedDrawing\(storagePath\)[\s\S]*from\('drawings'\)\.remove/);
  assert.match(migration, /drawings_storage_delete_own_recent/);
  assert.match(migration, /owner = \(select auth\.uid\(\)\)/);
  assert.match(migration, /15 minutes/);
  assert.match(migration, /can_access_site/);
  assert.match(migration, /site_is_active/);
  assert.match(migration, /is_cm_or_owner/);
  assert.match(migration, /foldername\(name\)\)\[3\] is null/);
  assert.doesNotMatch(migration, /allow_delete_query/);
  assert.doesNotMatch(migration, /drop policy if exists drawings_storage_delete on/);
  assert.doesNotMatch(screen, /allow_delete_query/);
  assert.doesNotMatch(repo, /allow_delete_query/);
});
