import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';

const migrationFile = fs
  .readdirSync('supabase/migrations')
  .find((name) => name.endsWith('_pre_lad_security.sql'));

test('operative and contracts manager people reads stay on their sites', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const rio = await fixtureRepo.addNoLoginOperative({ displayName: 'Rio Kent', siteIds: [IDS.riverside] });
  const sam = await fixtureRepo.addNoLoginOperative({ displayName: 'Sam Cole', siteIds: [] });
  const nia = await fixtureRepo.addNoLoginOperative({ displayName: 'Nia Ward', siteIds: [IDS.warehouse] });
  const ownerRows = await fixtureRepo.listCompanyPeople();
  assert.equal(ownerRows.some((person) => person.id === sam && person.email === null), true);
  assert.equal(ownerRows.find((person) => person.id === IDS.amy)?.email, 'amy@sitepack.test');
  const ownerList = await fixtureRepo.companyPeople();
  assert.equal(ownerList.some((person) => person.id === sam && person.site_names.length === 0), true);
  assert.equal(ownerList.some((person) => person.id === rio), true);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('ben@sitepack.test', SEED_PASSWORD);
  const benRows = await fixtureRepo.listCompanyPeople();
  assert.deepEqual(
    benRows.map((person) => person.id).sort(),
    [IDS.amy, IDS.ben, IDS.cm].sort(),
  );
  assert.equal(
    benRows.every((person) => person.email === null && person.phone === null),
    true,
  );
  assert.equal((await fixtureRepo.me())?.email, 'ben@sitepack.test');
  assert.equal((await fixtureRepo.me())?.phone, null);
  const oakCrew = await fixtureRepo.listAssignments(IDS.oak);
  assert.equal(oakCrew.find((row) => row.person_id === IDS.amy)?.person?.email, null);
  assert.equal(oakCrew.find((row) => row.person_id === IDS.amy)?.person?.display_name, 'Amy Keane');
  await assert.rejects(() => fixtureRepo.companyPeople(), /not_authorized/);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  assert.deepEqual(
    (await fixtureRepo.listCompanyPeople()).map((person) => person.id).sort(),
    [IDS.amy, IDS.ben, IDS.cm, rio].sort(),
  );

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  const cmRows = await fixtureRepo.companyPeople();
  assert.deepEqual(
    cmRows.map((person) => person.id).sort(),
    [IDS.amy, IDS.ben, IDS.cm, nia].sort(),
  );
  const amy = cmRows.find((person) => person.id === IDS.amy);
  assert.deepEqual(amy?.site_names, ['Plot 12 – Oak Estate', 'Plot 4 – Riverside']);
  assert.equal(JSON.stringify(cmRows).includes('email'), false);
  const cmDirectory = await fixtureRepo.listCompanyPeople();
  assert.deepEqual(
    cmDirectory.map((person) => person.id).sort(),
    [IDS.amy, IDS.ben, IDS.cm, nia].sort(),
  );
  assert.equal(
    cmDirectory.every((person) => person.email === null && person.phone === null),
    true,
  );
  assert.equal((await fixtureRepo.me())?.email, 'cm@sitepack.test');
});

test('the pre-lad migration locks the people read and the anon RPC', () => {
  assert.ok(migrationFile);
  const sql = fs.readFileSync(`supabase/migrations/${migrationFile}`, 'utf8');
  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');

  assert.match(sql, /drop policy if exists people_select_same_company/);
  assert.match(sql, /create policy people_select_visible/);
  assert.match(sql, /private\.my_role\(\) = 'owner'/);
  assert.match(sql, /auth_user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /private\.shares_assigned_site\(id\)/);
  assert.match(sql, /revoke select on table public\.people from public, anon, authenticated/);

  const grant = sql.slice(sql.indexOf('grant select ('), sql.indexOf(') on table public.people to authenticated'));
  assert.match(grant, /display_name/);
  assert.equal(grant.includes('email'), false);
  assert.equal(grant.includes('phone'), false);

  const view = sql.slice(sql.indexOf('create view public.people_directory'), sql.indexOf('comment on view public.people_directory'));
  assert.match(view, /security_invoker = true/);
  assert.equal(view.includes('email'), false);
  assert.equal(view.includes('phone'), false);

  const mine = sql.slice(sql.indexOf('function public.my_person'), sql.indexOf('comment on function public.my_person'));
  assert.match(mine, /security definer/);
  assert.match(mine, /set search_path = ''/);
  assert.match(mine, /p\.auth_user_id = \(select auth\.uid\(\)\)/);
  assert.match(mine, /'email', p\.email/);
  assert.match(sql, /revoke all on function public\.my_person\(\) from public, anon/);
  assert.match(sql, /grant execute on function public\.my_person\(\) to authenticated/);

  const labour = sql.slice(sql.indexOf('function public.company_people'), sql.indexOf('comment on function public.company_people'));
  assert.match(labour, /private\.shares_assigned_site\(p\.id\)/);
  assert.match(labour, /v_role = 'owner'/);
  assert.doesNotMatch(labour, /'email'/);

  assert.match(sql, /revoke all on function public\.site_contracts_manager_names\(uuid\) from public, anon/);
  assert.match(sql, /grant execute on function public\.site_contracts_manager_names\(uuid\) to authenticated/);
  assert.doesNotMatch(sql, /grant execute on function public\.site_contracts_manager_names\(uuid\) to anon/);

  for (const name of ['try_uuid(text)', 'touch_updated_at()', 'storage_site_id(text)', 'storage_company_id(text)', 'guard_site_archive()']) {
    assert.match(sql, new RegExp(`alter function private\\.${name.replace('(', '\\(').replace(')', '\\)')} set search_path = ''`));
  }

  assert.match(repo, /from\('people_directory'\)/);
  assert.match(repo, /rpc\('my_person'\)/);
  assert.match(repo, /people!drawing_requests_requester_id_fkey\(display_name\)/);
  assert.doesNotMatch(repo, /from\('people'\)/);
  assert.doesNotMatch(repo, /people\(\*\)/);
  assert.doesNotMatch(repo, /display_name, email/);
});
