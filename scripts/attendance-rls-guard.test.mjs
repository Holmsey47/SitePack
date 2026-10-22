import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

const migration = 'supabase/migrations/20261022180000_site_attendance.sql';

test('the attendance migration does not touch storage or auth', () => {
  const sql = fs.readFileSync(migration, 'utf8');
  assert.doesNotMatch(sql, /alter table storage/i);
  assert.doesNotMatch(sql, /grant\s+[\s\S]*\bon\s+schema\s+storage/i);
  assert.doesNotMatch(sql, /grant\s+[\s\S]*\bon\s+schema\s+auth/i);
  assert.doesNotMatch(sql, /storage\.objects/i);
  assert.doesNotMatch(sql, /auth\.users/i);
  assert.match(sql, /revoke all on function public\.sign_in_site\(uuid, timestamptz\) from public, anon;/);
  assert.match(sql, /revoke all on function public\.weekly_attendance\(uuid, date\) from public, anon;/);
  assert.match(sql, /revoke all on function private\.attendance_actor\(\) from public, anon, authenticated;/);
});

test('the attendance probe refuses a hosted Supabase URL and installs anon default grants first', () => {
  const missing = spawnSync('bash', ['scripts/run-attendance-rls.sh'], {
    env: { ...process.env, DATABASE_URL: '' },
    encoding: 'utf8',
  });
  assert.notEqual(missing.status, 0);
  assert.match(`${missing.stderr}`, /DATABASE_URL is required/);

  const hosted = spawnSync('bash', ['scripts/run-attendance-rls.sh'], {
    env: { ...process.env, DATABASE_URL: 'postgres://postgres:secret@db.example.supabase.co:5432/postgres' },
    encoding: 'utf8',
  });
  assert.notEqual(hosted.status, 0);
  assert.match(`${hosted.stderr}`, /Refusing to run against a hosted Supabase URL/);
  assert.doesNotMatch(`${hosted.stdout}${hosted.stderr}`, /secret/);

  const runner = fs.readFileSync('scripts/run-attendance-rls.sh', 'utf8');
  assert.match(
    runner,
    /20261022180000_site_attendance\.sql[\s\S]*anon-default-grants\.sql[\s\S]*-f "\$migration"/
  );
  const stub = fs.readFileSync('scripts/anon-default-grants.sql', 'utf8');
  assert.match(stub, /grant execute on functions to anon, authenticated, service_role/);
});

test('attendance files stay on hours', () => {
  const files = [
    migration,
    'lib/attendanceHours.ts',
    'lib/attendancePdf.ts',
    'lib/attendanceQueue.ts',
    'data/attendance.ts',
    'data/fixtureAttendance.ts',
    'components/SiteSignButton.tsx',
    'app/(app)/sites/[siteId]/attendance/index.tsx',
    'app/(app)/sites/[siteId]/attendance/week.tsx',
    'app/(app)/sites/[siteId]/attendance/[entryId].tsx',
  ];
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(source, /£|\bCIS\b|\brates?\b|\bpay\b|\bwages?\b|break rule/i);
});
