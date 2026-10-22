import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

test('the snag migration does not touch storage or auth', () => {
  const sql = fs.readFileSync('supabase/migrations/20261022170000_snags.sql', 'utf8');
  assert.doesNotMatch(sql, /alter table storage/i);
  assert.doesNotMatch(sql, /grant\s+[\s\S]*\bon\s+schema\s+storage/i);
  assert.doesNotMatch(sql, /grant\s+[\s\S]*\bon\s+schema\s+auth/i);
  assert.doesNotMatch(sql, /storage\.objects/i);
  assert.doesNotMatch(sql, /auth\.users/i);
});

test('the snag probe refuses a hosted Supabase URL', () => {
  const missing = spawnSync('bash', ['scripts/run-snag-rls.sh'], {
    env: { ...process.env, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  assert.notEqual(missing.status, 0);
  assert.match(`${missing.stderr}`, /DATABASE_URL is required/);

  const hosted = spawnSync('bash', ['scripts/run-snag-rls.sh'], {
    env: { ...process.env, DATABASE_URL: 'postgres://postgres:secret@db.example.supabase.co:5432/postgres' },
    encoding: 'utf8',
  });
  assert.notEqual(hosted.status, 0);
  assert.match(`${hosted.stderr}`, /Refusing to run against a hosted Supabase URL/);
  assert.doesNotMatch(`${hosted.stdout}${hosted.stderr}`, /secret/);
});
