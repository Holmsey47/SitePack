import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

test('the drawing delete migration is additive and does not enable delete queries', () => {
  const sql = fs.readFileSync('supabase/migrations/20261030141500_drawings_storage_delete_own_recent.sql', 'utf8');
  assert.match(sql, /create policy drawings_storage_delete_own_recent/);
  assert.match(sql, /SECURITY: review this storage delete policy/);
  assert.doesNotMatch(sql, /allow_delete_query/);
  assert.doesNotMatch(sql, /drop policy if exists drawings_storage_delete on storage\.objects/);
  assert.doesNotMatch(sql, /create or replace function/i);
  const standIn = fs.readFileSync('scripts/throwaway-auth.sql', 'utf8');
  assert.match(standIn, /add column if not exists created_at/);
});

test('the drawing storage probe refuses a hosted Supabase URL', () => {
  const missing = spawnSync('bash', ['scripts/run-drawing-storage-delete-rls.sh'], {
    env: { ...process.env, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  assert.notEqual(missing.status, 0);
  assert.match(`${missing.stderr}`, /DATABASE_URL is required/);

  const hosted = spawnSync('bash', ['scripts/run-drawing-storage-delete-rls.sh'], {
    env: { ...process.env, DATABASE_URL: 'postgres://postgres:secret@db.example.supabase.co:5432/postgres' },
    encoding: 'utf8',
  });
  assert.notEqual(hosted.status, 0);
  assert.match(`${hosted.stderr}`, /Refusing to run against a hosted Supabase URL/);
  assert.doesNotMatch(`${hosted.stdout}${hosted.stderr}`, /secret/);
});
