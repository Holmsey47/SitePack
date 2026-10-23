import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20261022200000_main_contractor_sharing.sql';

function functionsIn(sql) {
  const found = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+((?:public|private)\.[a-z0-9_]+)\s*\(/gi;
  for (const match of sql.matchAll(re)) {
    const name = match[1];
    const window = sql.slice(match.index, match.index + 700);
    found.push({
      name,
      definer: /security\s+definer/i.test(window),
      emptyPath: /set\s+search_path\s*=\s*''/i.test(window),
    });
  }
  return found;
}

test('the sharing migration pins search_path and revokes anon on every function it creates', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const replacedNames = new Set(['private.visible_variation_pence', 'private.visible_shown_pence']);
  const parsed = functionsIn(sql);
  const created = parsed.filter((fn) => !replacedNames.has(fn.name));
  const replaced = parsed.filter((fn) => replacedNames.has(fn.name));
  assert.equal(created.length, 28, `parsed ${created.length} new functions`);
  assert.equal(replaced.length, 2);
  for (const fn of [...created, ...replaced]) {
    assert.equal(fn.definer, true, fn.name);
    assert.equal(fn.emptyPath, true, fn.name);
    const escaped = fn.name.replace('.', '\\.');
    assert.match(sql, new RegExp(`revoke all on function ${escaped}\\(`, 'i'), fn.name);
  }
  assert.match(sql, /from\s+storage\.objects/i);
  assert.doesNotMatch(sql, /function\s+private\.can_access_site/i);
  assert.doesNotMatch(sql, /alter table storage/i);
  assert.doesNotMatch(sql, /grant\s+[\s\S]*\bon\s+schema\s+storage/i);
  assert.doesNotMatch(sql, /grant\s+[\s\S]*\bon\s+schema\s+auth/i);
  assert.doesNotMatch(sql, /grant\s+[\s\S]*\bon\s+table\s+storage/i);
  assert.doesNotMatch(sql, /auth\.users/i);
});

test('the sharing probe refuses a hosted Supabase URL and diffs pg_proc after anon grants', () => {
  const missing = spawnSync('bash', ['scripts/run-sharing-rls.sh'], {
    env: { ...process.env, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  assert.notEqual(missing.status, 0);
  assert.match(`${missing.stderr}`, /DATABASE_URL is required/);

  const hosted = spawnSync('bash', ['scripts/run-sharing-rls.sh'], {
    env: { ...process.env, DATABASE_URL: 'postgres://postgres:secret@db.example.supabase.co:5432/postgres' },
    encoding: 'utf8',
  });
  assert.notEqual(hosted.status, 0);
  assert.match(`${hosted.stderr}`, /Refusing to run against a hosted Supabase URL/);
  assert.doesNotMatch(`${hosted.stdout}${hosted.stderr}`, /secret/);

  const dotCom = spawnSync('bash', ['scripts/run-sharing-rls.sh'], {
    env: { ...process.env, DATABASE_URL: 'postgres://postgres:secret@db.example.supabase.com:5432/postgres' },
    encoding: 'utf8',
  });
  assert.notEqual(dotCom.status, 0);
  assert.match(`${dotCom.stderr}`, /Refusing to run against a hosted Supabase URL/);

  const runner = fs.readFileSync('scripts/run-sharing-rls.sh', 'utf8');
  assert.match(
    runner,
    /20261022200000_main_contractor_sharing\.sql[\s\S]*anon-default-grants\.sql[\s\S]*proc_catalog_before[\s\S]*-f "\$migration"/
  );
  const stub = fs.readFileSync('scripts/anon-default-grants.sql', 'utf8');
  assert.match(stub, /grant all on functions to anon, authenticated, service_role/);
});
