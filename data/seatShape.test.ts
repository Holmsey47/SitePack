import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';

const migrationPath = 'supabase/migrations/20260923120000_people_seat_shape.sql';

test('fixture people use the seat shape', async (t) => {
  await t.test('existing people keep the login on their current id', async () => {
    resetFixtureStore();
    const owner = await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
    assert.equal(owner.person.id, IDS.owner);
    assert.equal(owner.person.auth_user_id, IDS.owner);

    await fixtureRepo.signOut();
    const operative = await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
    assert.equal(operative.person.auth_user_id, operative.person.id);
    const sites = await fixtureRepo.listAssignedSites();
    assert.deepEqual(
      sites.map((site) => site.id).sort(),
      [IDS.oak, IDS.riverside].sort(),
    );
  });

  await t.test('a fresh invite gets a new person id, distinct from the login, and only that site', async () => {
    resetFixtureStore();
    await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
    await fixtureRepo.invitePerson({
      email: 'new.operative@sitepack.test',
      displayName: 'New Operative',
      role: 'operative',
      siteId: IDS.oak,
    });

    const invited = (await fixtureRepo.listCompanyPeople()).find((person) => person.email === 'new.operative@sitepack.test');
    assert.ok(invited?.auth_user_id);
    assert.notEqual(invited.id, invited.auth_user_id);

    const assigned = await fixtureRepo.listAssignments(IDS.oak);
    assert.equal(
      assigned.some((row) => row.person_id === invited.id),
      true,
    );
    assert.equal(
      assigned.some((row) => row.person_id === invited.auth_user_id),
      false,
    );

    await fixtureRepo.signOut();
    const session = await fixtureRepo.signIn('new.operative@sitepack.test', SEED_PASSWORD);
    assert.equal(session.person.id, invited.id);
    const sites = await fixtureRepo.listAssignedSites();
    assert.deepEqual(
      sites.map((site) => site.id),
      [IDS.oak],
    );
  });
});

test('the seat-shape migration replaces the full caller list and leaves the shipped files', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const v0 = fs.readFileSync('supabase/migrations/20260918120000_sitepack_v0.sql', 'utf8');
  const folders = fs.readFileSync('supabase/migrations/20260922170000_drawing_folders.sql', 'utf8');

  assert.match(v0, /where p\.id = \(select auth\.uid\(\)\)/);
  assert.match(folders, /p_folder text default null/);
  assert.match(folders, /\(select auth\.uid\(\)\)/);

  assert.match(sql, /drop constraint people_id_fkey/);
  assert.match(sql, /set auth_user_id = id/);
  assert.match(sql, /on delete set null/);
  assert.match(sql, /people_email_not_blank/);
  assert.match(sql, /check \(email is null or btrim\(email\) <> ''\)/);
  assert.match(sql, /revoke insert on table public\.people from authenticated/);
  assert.match(sql, /drop policy if exists people_insert_owner/);
  assert.match(sql, /auth_user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /where p\.auth_user_id = \(select auth\.uid\(\)\)/);

  const drawing = sql.slice(
    sql.indexOf('create or replace function public.replace_drawing'),
    sql.indexOf('create or replace function public.company_sites_pulse'),
  );
  assert.match(drawing, /p_folder text default null/);
  assert.match(drawing, /p\.auth_user_id = \(select auth\.uid\(\)\)/);
  assert.match(drawing, /v_actor,\s*v_folder/);
  assert.match(drawing, /p_site_id, v_actor, v_action/);
  assert.doesNotMatch(drawing, /uploaded_by,\s*folder\s*\) values \([\s\S]*\(select auth\.uid\(\)\)/);
  assert.match(
    sql,
    /grant execute on function public\.replace_drawing\(\s*uuid, text, text, text, text, date, bigint, text, uuid, uuid, text\s*\) to authenticated/,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.replace_drawing\(\s*uuid, text, text, text, text, date, bigint, text, uuid, uuid\s*\) to authenticated/,
  );

  const pulse = sql.slice(sql.indexOf('create or replace function public.company_sites_pulse'));
  assert.match(pulse, /v_role = 'owner'/);
  assert.match(pulse, /a\.person_id = v_actor/);
  assert.doesNotMatch(pulse, /a\.person_id = \(select auth\.uid\(\)\)/);

  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
  assert.match(repo, /\.eq\('auth_user_id', userData\.user\.id\)/);
  assert.doesNotMatch(repo, /\.eq\('id', userData\.user\.id\)/);

  const invite = fs.readFileSync('supabase/functions/invite-person/index.ts', 'utf8');
  assert.match(invite, /\.eq\('auth_user_id', userData\.user\.id\)/);
  assert.match(invite, /auth_user_id: invited\.user\.id/);
  assert.match(invite, /person_id: created\.id/);
  assert.doesNotMatch(invite, /^\s*id: invited\.user\.id/m);
  assert.doesNotMatch(invite, /person_id: invited\.user\.id/);
});
