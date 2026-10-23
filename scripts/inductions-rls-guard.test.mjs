import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

const migration = 'supabase/migrations/20261022190000_inductions.sql';

test('the inductions migration does not alter storage tables or auth', () => {
  const sql = fs.readFileSync(migration, 'utf8');
  assert.match(sql, /from storage\.objects/);
  assert.doesNotMatch(sql, /insert\s+into\s+storage\.objects/i);
  assert.doesNotMatch(sql, /update\s+storage\.objects/i);
  assert.doesNotMatch(sql, /delete\s+from\s+storage\.objects/i);
  assert.doesNotMatch(sql, /alter table storage/i);
  assert.doesNotMatch(sql, /^grant\s+.*\bon\s+schema\s+storage/im);
  assert.doesNotMatch(sql, /^grant\s+.*\bon\s+(table\s+)?storage\.objects/im);
  assert.doesNotMatch(sql, /^grant\s+.*\bon\s+schema\s+auth/im);
  assert.doesNotMatch(sql, /auth\.users/i);
  assert.doesNotMatch(sql, /create policy drawings_storage_select/i);
  assert.doesNotMatch(sql, /create policy drawings_storage_insert/i);
  assert.match(sql, /drop policy if exists drawings_storage_update on storage\.objects/);
  assert.match(sql, /drop policy if exists drawings_storage_delete on storage\.objects/);
  assert.match(sql, /create policy drawings_storage_update[\s\S]*on storage\.objects for update/);
  assert.match(sql, /create policy drawings_storage_delete[\s\S]*on storage\.objects for delete/);
  assert.match(sql, /private\.talk_pdf_locked\(name\)/);
  assert.match(sql, /from storage\.objects objects/);
  assert.match(sql, /revoke all on function public\.sign_site_talk\(uuid, uuid, uuid, boolean, text, timestamptz, text\) from public, anon;/);
  assert.match(sql, /revoke all on function public\.create_site_talk\(uuid, text, text, text, text, text, text, uuid\[\], uuid, text, timestamptz\) from public, anon;/);
  assert.match(sql, /revoke all on function private\.talk_actor\(\) from public, anon, authenticated;/);
  assert.match(sql, /revoke all on function private\.talk_meaning\(text, text, text, text, text, text, timestamptz\) from public, anon, authenticated;/);
});

test('the inductions probe refuses a hosted Supabase URL and installs anon default grants first', () => {
  const missing = spawnSync('bash', ['scripts/run-inductions-rls.sh'], {
    env: { ...process.env, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  assert.notEqual(missing.status, 0);
  assert.match(`${missing.stderr}`, /DATABASE_URL is required/);

  const hosted = spawnSync('bash', ['scripts/run-inductions-rls.sh'], {
    env: { ...process.env, DATABASE_URL: 'postgres://postgres:secret@db.example.supabase.co:5432/postgres' },
    encoding: 'utf8',
  });
  assert.notEqual(hosted.status, 0);
  assert.match(`${hosted.stderr}`, /Refusing to run against a hosted Supabase URL/);
  assert.doesNotMatch(`${hosted.stdout}${hosted.stderr}`, /secret/);

  const dotCom = spawnSync('bash', ['scripts/run-inductions-rls.sh'], {
    env: { ...process.env, DATABASE_URL: 'postgres://postgres:secret@db.example.supabase.com:5432/postgres' },
    encoding: 'utf8',
  });
  assert.notEqual(dotCom.status, 0);
  assert.match(`${dotCom.stderr}`, /Refusing to run against a hosted Supabase URL/);

  const runner = fs.readFileSync('scripts/run-inductions-rls.sh', 'utf8');
  assert.match(runner, /20261022190000_inductions\.sql[\s\S]*anon-default-grants\.sql[\s\S]*-f "\$migration"/);
  assert.match(runner, /probe_funcs_before/);
  const probe = fs.readFileSync('scripts/inductions-rls.sql', 'utf8');
  assert.doesNotMatch(probe, /proname in/);
  assert.match(probe, /new_talk_funcs/);
  assert.match(probe, /permission denied for function/);
  const stub = fs.readFileSync('scripts/anon-default-grants.sql', 'utf8');
  assert.match(stub, /grant all on functions to anon, authenticated, service_role/);
});
