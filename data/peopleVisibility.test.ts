import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';
import { personLabel, previewName } from './walk.ts';

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

  const view = sql.slice(
    sql.indexOf('create or replace view public.people_directory'),
    sql.indexOf('comment on view public.people_directory'),
  );
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

  assert.match(sql, /drop policy if exists people_select_visible/);
  assert.match(sql, /to_regclass\('public\.people'\) is not null/);
  assert.match(sql, /to_regprocedure\('public\.my_person\(\)'\) is not null/);

  const pulse = sql.slice(
    sql.indexOf('function public.company_sites_pulse'),
    sql.indexOf('comment on function public.company_sites_pulse'),
  );
  assert.match(pulse, /coalesce\(nullif\(btrim\(p\.display_name\), ''\), 'Unknown'\)/);
  assert.doesNotMatch(pulse, /p\.email/);
  assert.match(sql, /to_regprocedure\('public\.company_sites_pulse\(\)'\) is not null/);

  const contacts = sql.slice(
    sql.indexOf('function public.company_contacts'),
    sql.indexOf('comment on function public.company_contacts'),
  );
  assert.match(contacts, /security definer/);
  assert.match(contacts, /set search_path = ''/);
  assert.match(contacts, /v_role is distinct from 'owner'/);
  assert.match(contacts, /not_authorized/);
  assert.match(contacts, /'email', p\.email/);
  assert.match(contacts, /'phone', p\.phone/);
  assert.match(sql, /revoke all on function public\.company_contacts\(\) from public, anon/);
  assert.match(sql, /grant execute on function public\.company_contacts\(\) to authenticated/);
  assert.match(sql, /to_regprocedure\('public\.company_contacts\(\)'\) is not null/);

  assert.match(sql, /revoke all on function public\.site_contracts_manager_names\(uuid\) from public, anon/);
  assert.match(sql, /grant execute on function public\.site_contracts_manager_names\(uuid\) to authenticated/);
  assert.doesNotMatch(sql, /grant execute on function public\.site_contracts_manager_names\(uuid\) to anon/);

  for (const name of ['try_uuid(text)', 'touch_updated_at()', 'storage_site_id(text)', 'storage_company_id(text)', 'guard_site_archive()']) {
    assert.match(sql, new RegExp(`alter function private\\.${name.replace('(', '\\(').replace(')', '\\)')} set search_path = ''`));
  }

  assert.match(repo, /from\('people_directory'\)/);
  assert.match(repo, /rpc\('my_person'\)/);
  assert.match(repo, /rpc\('company_contacts'\)/);
  assert.match(repo, /people!drawing_requests_requester_id_fkey\(display_name\)/);
  assert.doesNotMatch(repo, /from\('people'\)/);
  assert.doesNotMatch(repo, /people\(\*\)/);
  assert.doesNotMatch(repo, /display_name, email/);

  const pulseFn = fs
    .readFileSync('data/fixtureRepo.ts', 'utf8')
    .slice(
      fs.readFileSync('data/fixtureRepo.ts', 'utf8').indexOf('async companySitesPulse'),
      fs.readFileSync('data/fixtureRepo.ts', 'utf8').indexOf('async archiveSite'),
    );
  assert.match(pulseFn, /previewName\(/);
  assert.doesNotMatch(pulseFn, /email/);
});

test('a member sees their own company owner name and role on a site', async () => {
  resetFixtureStore();
  const migration = fs
    .readdirSync('supabase/migrations')
    .find((name) => name.endsWith('_company_owner_label.sql'));
  assert.ok(migration);
  const sql = fs.readFileSync(`supabase/migrations/${migration}`, 'utf8');
  assert.match(sql, /function private\.company_owner_label\(\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /p\.company_id = private\.my_company_id\(\)/);
  assert.match(sql, /p\.role = 'owner'/);
  assert.match(sql, /private\.can_access_site\(s\.id\)/);
  assert.match(sql, /revoke all on function private\.company_owner_label\(\) from public, anon/);
  assert.match(sql, /grant execute on function private\.company_owner_label\(\) to authenticated/);
  assert.equal(sql.includes('grant execute on function private.company_owner_label() to anon'), false);
  assert.equal(sql.includes('grant execute on function private.company_owner_label() to public'), false);
  assert.match(sql, /security_barrier = true/);
  assert.match(sql, /security_invoker = true/);
  assert.equal(sql.includes('security_invoker = false'), false);
  const view = sql.slice(sql.indexOf('view public.company_owner_label'), sql.indexOf('comment on view public.company_owner_label'));
  assert.match(view, /display_name, role/);
  assert.equal(view.includes('email'), false);
  assert.equal(view.includes('phone'), false);
  assert.match(sql, /revoke all on table public\.company_owner_label from public, anon, authenticated/);
  assert.match(sql, /grant select on table public\.company_owner_label to authenticated/);
  assert.equal(sql.includes('create policy'), false);
  assert.equal(sql.includes('people_select_visible'), false);

  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
  const labelFn = repo.slice(repo.indexOf('async companyOwnerLabel'), repo.indexOf('async listAssignments'));
  assert.match(labelFn, /from\('company_owner_label'\)/);
  assert.match(labelFn, /select\('display_name, role'\)/);
  assert.doesNotMatch(labelFn, /email/);
  assert.doesNotMatch(labelFn, /phone/);

  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  const cmLabel = await fixtureRepo.companyOwnerLabel();
  assert.deepEqual(cmLabel, { display_name: 'Jordan Hale', role: 'owner' });
  assert.equal(Object.keys(cmLabel ?? {}).sort().join(), 'display_name,role');
  assert.equal((await fixtureRepo.listCompanyPeople()).some((person) => person.id === IDS.owner), false);
  assert.equal((await fixtureRepo.listAssignments(IDS.oak)).some((row) => row.person_id === IDS.owner), false);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
  assert.deepEqual(await fixtureRepo.companyOwnerLabel(), { display_name: 'Jordan Hale', role: 'owner' });
  assert.equal((await fixtureRepo.listCompanyPeople()).some((person) => person.id === IDS.owner), false);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('chris@sitepack.test', SEED_PASSWORD);
  assert.equal(await fixtureRepo.companyOwnerLabel(), null);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  assert.deepEqual(await fixtureRepo.companyOwnerLabel(), { display_name: 'Jordan Hale', role: 'owner' });
});

test('a contracts manager still gets names when the owner and unassigned staff are hidden', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const sam = await fixtureRepo.addNoLoginOperative({ displayName: 'Sam Cole', siteIds: [] });
  await fixtureRepo.signOut();

  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  const directory = await fixtureRepo.listCompanyPeople();
  const labour = await fixtureRepo.companyPeople();
  assert.equal(directory.some((person) => person.id === IDS.owner || person.id === sam), false);
  assert.equal(labour.some((person) => person.id === IDS.owner || person.id === sam), false);
  const assignments = await fixtureRepo.listAssignments(IDS.oak);
  assert.ok(assignments.length > 0);
  for (const row of [...assignments.map((row) => personLabel(row.person)), ...labour.map((row) => personLabel(row))]) {
    assert.equal(row.includes('undefined'), false);
    assert.notEqual(row, '');
  }
  assert.equal(personLabel(undefined), 'Unknown');
  assert.equal(personLabel({ display_name: null, email: null }), 'Unknown');
  assert.equal(personLabel({ display_name: '   ', email: null }), 'Unknown');
  assert.equal(personLabel({ display_name: '   ', email: 'amy@sitepack.test' }), 'amy@sitepack.test');
  assert.equal(personLabel({ display_name: 'Amy Keane', email: null }), 'Amy Keane');
  assert.equal(personLabel({ display_name: undefined, email: undefined }).includes('undefined'), false);
  assert.equal(previewName('   '), 'Unknown');
  assert.equal(previewName(null), 'Unknown');
  assert.equal(directory.every((person) => person.email === null && person.phone === null), true);

  const assignmentsScreen = fs.readFileSync('app/(app)/sites/[siteId]/assignments.tsx', 'utf8');
  const peopleScreen = fs.readFileSync('app/(app)/people.tsx', 'utf8');
  assert.match(assignmentsScreen, /personLabel\(/);
  assert.match(assignmentsScreen, /contactLine\(/);
  assert.match(peopleScreen, /personLabel\(/);
  assert.doesNotMatch(peopleScreen, /\.email/);
  assert.doesNotMatch(assignmentsScreen, /display_name \?\?/);
});

test('p1 refuses a signed-out contracts lookup and hides archived-site co-workers', async () => {
  const migration = fs
    .readdirSync('supabase/migrations')
    .find((name) => name.endsWith('_p1_security_before_logins.sql'));
  assert.ok(migration);
  const sql = fs.readFileSync(`supabase/migrations/${migration}`, 'utf8');
  const names = sql.slice(
    sql.indexOf('function public.site_contracts_manager_names'),
    sql.indexOf('comment on function public.site_contracts_manager_names'),
  );
  assert.match(names, /security definer/);
  assert.match(names, /set search_path = ''/);
  assert.match(names, /\(select auth\.uid\(\)\) is null/);
  assert.match(names, /not_authorized/);
  assert.match(names, /private\.can_access_site\(p_site_id\)/);
  assert.match(sql, /revoke all on function public\.site_contracts_manager_names\(uuid\) from public, anon/);
  assert.match(sql, /grant execute on function public\.site_contracts_manager_names\(uuid\) to authenticated/);
  assert.equal(sql.includes('grant execute on function public.site_contracts_manager_names(uuid) to anon'), false);
  assert.equal(sql.includes('grant execute on function public.site_contracts_manager_names(uuid) to public'), false);

  const shared = sql.slice(
    sql.indexOf('function private.shares_assigned_site'),
    sql.indexOf('comment on function private.shares_assigned_site'),
  );
  assert.match(shared, /security definer/);
  assert.match(shared, /set search_path = ''/);
  assert.match(shared, /join public\.sites s on s\.id = mine\.site_id/);
  assert.match(shared, /s\.archived_at is null/);

  for (const name of [
    'try_uuid(p_text text)',
    'touch_updated_at()',
    'storage_site_id(p_name text)',
    'storage_company_id(p_name text)',
    'guard_site_archive()',
  ]) {
    const body = sql.slice(sql.indexOf(`function private.${name}`));
    const next = body.indexOf('create or replace function', 1);
    const fn = next === -1 ? body : body.slice(0, next);
    assert.match(fn, /set search_path = ''/);
  }
  assert.match(sql, /pg_catalog\.length\(pg_catalog\.btrim\(p_text\)\)/);
  assert.match(sql, /pg_catalog\.btrim\(p_text\)::pg_catalog\.uuid/);
  assert.match(sql, /pg_catalog\.now\(\)/);
  assert.match(sql, /storage\.foldername\(p_name\)/);
  assert.match(sql, /private\.my_role\(\)/);

  const probe = fs.readFileSync('scripts/p1-security-rls.sql', 'utf8');
  assert.match(probe, /a signed-out RPC call is refused/);
  assert.match(probe, /a lad on an archived site sees 0 co-workers/);
  assert.match(probe, /a lad on an active site still sees those co-workers/);
  assert.match(probe, /the owner still sees people on the archived site/);
  assert.match(probe, /0 mutable search_path warnings/);

  resetFixtureStore();
  await fixtureRepo.signIn('ben@sitepack.test', SEED_PASSWORD);
  assert.deepEqual(
    (await fixtureRepo.listCompanyPeople()).map((person) => person.id).sort(),
    [IDS.amy, IDS.ben, IDS.cm].sort(),
  );

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.archiveSite(IDS.riverside, true);
  const ownerWhileOakIsActive = await fixtureRepo.listCompanyPeople();
  assert.equal(ownerWhileOakIsActive.some((person) => person.id === IDS.ben), true);
  assert.equal(ownerWhileOakIsActive.some((person) => person.id === IDS.amy), true);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('ben@sitepack.test', SEED_PASSWORD);
  assert.deepEqual(
    (await fixtureRepo.listCompanyPeople()).map((person) => person.id).sort(),
    [IDS.amy, IDS.ben, IDS.cm].sort(),
  );

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  await fixtureRepo.archiveSite(IDS.oak, true);
  const ownerAfter = await fixtureRepo.listCompanyPeople();
  assert.equal(ownerAfter.some((person) => person.id === IDS.ben), true);
  assert.equal(ownerAfter.some((person) => person.id === IDS.amy), true);
  assert.equal(ownerAfter.some((person) => person.id === IDS.cm), true);
  assert.equal((await fixtureRepo.companyPeople()).some((person) => person.id === IDS.ben), true);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('ben@sitepack.test', SEED_PASSWORD);
  assert.deepEqual(
    (await fixtureRepo.listCompanyPeople()).map((person) => person.id),
    [IDS.ben],
  );
  await assert.rejects(() => fixtureRepo.contractsManagerNames(IDS.oak), /not_authorized/);
});

test('only the owner can read other peoples contact details', async () => {
  resetFixtureStore();
  await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
  const contacts = await fixtureRepo.companyContacts();
  assert.equal(contacts.find((row) => row.id === IDS.amy)?.email, 'amy@sitepack.test');
  assert.equal(contacts.find((row) => row.id === IDS.ben)?.phone, null);
  const listed = await fixtureRepo.listCompanyPeople();
  assert.equal(listed.find((person) => person.id === IDS.amy)?.email, 'amy@sitepack.test');
  assert.equal(listed.some((person) => person.id === IDS.owner), true);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
  await assert.rejects(() => fixtureRepo.companyContacts(), /not_authorized/);
  assert.equal((await fixtureRepo.listCompanyPeople()).every((person) => person.email === null), true);

  await fixtureRepo.signOut();
  await fixtureRepo.signIn('ben@sitepack.test', SEED_PASSWORD);
  await assert.rejects(() => fixtureRepo.companyContacts(), /not_authorized/);
  assert.equal((await fixtureRepo.listCompanyPeople()).every((person) => person.phone === null), true);
});
