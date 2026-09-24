import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  canAddNoLogin,
  canAttachLogin,
  peopleFailureMessage,
  peopleLoadFailureMessage,
  removableSites,
  roleLabel,
  siteLabel,
} from './companyPeople.ts';
import { fixtureRepo, resetFixtureStore } from './fixtureRepo.ts';
import { IDS, SEED_PASSWORD } from './ids.ts';

const migrationPath = 'supabase/migrations/20260923160000_company_people.sql';

test('people list rules', () => {
  assert.equal(roleLabel('cm'), 'Contracts manager');
  assert.equal(roleLabel('operative'), 'Operative');
  assert.equal(siteLabel([]), 'Unassigned');
  assert.equal(siteLabel(['Oak', 'Yard']), 'Oak, Yard');
  assert.equal(canAddNoLogin('operative', 'Lee', ['oak']), false);
  assert.equal(canAddNoLogin('cm', 'Lee', []), false);
  assert.equal(canAddNoLogin('cm', '  ', ['oak']), false);
  assert.equal(canAddNoLogin('cm', 'Lee', ['oak']), true);
  assert.equal(canAddNoLogin('owner', 'Lee', []), true);
  assert.equal(peopleFailureMessage('email_in_use'), 'That email is already used in this company.');
  assert.equal(peopleLoadFailureMessage(new Error('unknown')), 'Could not load people.');
  assert.equal(peopleLoadFailureMessage(new Error('  unknown  ')), 'Could not load people.');
  assert.equal(peopleLoadFailureMessage(new Error('')), 'Could not load people.');
  assert.equal(peopleLoadFailureMessage(undefined), 'Could not load people.');
  assert.equal(peopleLoadFailureMessage(new Error('not_authorized')), 'You can’t do that.');

  const noLogin = { role: 'operative' as const, has_login: false, site_names: ['Plot 4 – Riverside'] };
  const loggedIn = { role: 'operative' as const, has_login: true, site_names: ['Plot 12 – Oak Estate'] };
  const callerSites = [
    { site_id: 'oak', name: 'Plot 12 – Oak Estate' },
    { site_id: 'yard', name: 'Warehouse – North Yard' },
  ];
  assert.equal(canAttachLogin('cm', noLogin, callerSites), false);
  assert.equal(canAttachLogin('owner', noLogin, callerSites), true);
  assert.equal(canAttachLogin('owner', loggedIn, callerSites), false);
  assert.equal(canAttachLogin('cm', { ...noLogin, site_names: ['Plot 12 – Oak Estate'] }, callerSites), true);
  assert.deepEqual(removableSites({ role: 'operative', site_names: ['Plot 12 – Oak Estate', 'Plot 4 – Riverside'] }, callerSites), [
    callerSites[0],
  ]);
  assert.deepEqual(removableSites({ role: 'cm', site_names: ['Plot 12 – Oak Estate'] }, callerSites), []);
});

test('company people read, no-login operative, and attach', async (t) => {
  const fields = ['display_name', 'has_login', 'id', 'role', 'site_names', 'trade'];

  await t.test('owner and contracts manager see everyone, including a person on no site', async () => {
    resetFixtureStore();
    await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
    const rows = await fixtureRepo.companyPeople();
    assert.ok(rows.length >= 4);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), fields);
      assert.equal(
        row.site_names.every((name) => typeof name === 'string'),
        true,
      );
    }
    const owner = rows.find((row) => row.id === IDS.owner);
    assert.ok(owner);
    assert.deepEqual(owner.site_names, []);
    assert.equal(owner.has_login, true);
    const amy = rows.find((row) => row.id === IDS.amy);
    assert.ok(amy);
    assert.equal(amy.display_name, 'Amy Keane');

    await fixtureRepo.signOut();
    await fixtureRepo.signIn('amy@sitepack.test', SEED_PASSWORD);
    await assert.rejects(() => fixtureRepo.companyPeople(), /not_authorized/);
  });

  await t.test('the contracts manager sees a site name they are not on, and the pack stays closed', async () => {
    resetFixtureStore();
    await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
    const rows = await fixtureRepo.companyPeople();
    const amy = rows.find((row) => row.id === IDS.amy);
    assert.ok(amy);
    assert.deepEqual(amy.site_names, ['Plot 12 – Oak Estate', 'Plot 4 – Riverside']);
    assert.equal(JSON.stringify(amy).includes(IDS.riverside), false);
    assert.equal(JSON.stringify(amy).includes(IDS.yard), false);
    assert.equal(JSON.stringify(rows).includes('"email"'), false);

    assert.equal(await fixtureRepo.getSite(IDS.riverside), null);
    await assert.rejects(() => fixtureRepo.listDrawings(IDS.riverside), /not_authorized/);
    await assert.rejects(() => fixtureRepo.sitePackManifest(IDS.riverside), /not_authorized/);
    assert.deepEqual(
      (await fixtureRepo.listAssignedSites()).map((site) => site.id).sort(),
      [IDS.oak, IDS.warehouse].sort(),
    );
    assert.deepEqual(
      (await fixtureRepo.companySitesPulse()).map((site) => site.site_id).sort(),
      [IDS.oak, IDS.warehouse].sort(),
    );
  });

  await t.test('a contracts manager adds a no-login operative on a site they are on', async () => {
    resetFixtureStore();
    await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);
    const before = (await fixtureRepo.companySitesPulse()).find((site) => site.site_id === IDS.oak);
    const id = await fixtureRepo.addNoLoginOperative({
      displayName: 'Pat Doyle',
      trade: ' plasterer ',
      siteIds: [IDS.oak],
    });
    const row = (await fixtureRepo.companyPeople()).find((person) => person.id === id);
    assert.ok(row);
    assert.equal(row.display_name, 'Pat Doyle');
    assert.equal(row.role, 'operative');
    assert.equal(row.trade, 'plasterer');
    assert.equal(row.has_login, false);
    assert.deepEqual(row.site_names, ['Plot 12 – Oak Estate']);
    assert.equal(JSON.stringify(row).includes('email'), false);

    const stored = (await fixtureRepo.listCompanyPeople()).find((person) => person.id === id);
    assert.equal(stored?.email, null);
    assert.equal(stored?.auth_user_id, null);
    assert.equal(
      (await fixtureRepo.listAssignments(IDS.oak)).some((assignment) => assignment.person_id === id),
      true,
    );
    const after = (await fixtureRepo.companySitesPulse()).find((site) => site.site_id === IDS.oak);
    assert.equal(after?.assignee_count, (before?.assignee_count ?? 0) + 1);

    await fixtureRepo.signOut();
    await assert.rejects(() => fixtureRepo.signIn('pat.doyle@sitepack.test', SEED_PASSWORD));
  });

  await t.test('a contracts manager cannot add or remove on a site they are not on', async () => {
    resetFixtureStore();
    await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
    const riversideId = await fixtureRepo.addNoLoginOperative({
      displayName: 'Rio Kent',
      siteIds: [IDS.riverside],
    });
    const unassignedId = await fixtureRepo.addNoLoginOperative({
      displayName: 'Sam Cole',
      siteIds: [],
    });
    await fixtureRepo.signOut();
    await fixtureRepo.signIn('cm@sitepack.test', SEED_PASSWORD);

    await assert.rejects(
      () => fixtureRepo.addNoLoginOperative({ displayName: 'Pat Doyle', siteIds: [IDS.riverside] }),
      /not_authorized/,
    );
    await assert.rejects(
      () => fixtureRepo.addNoLoginOperative({ displayName: 'Pat Doyle', siteIds: [] }),
      /not_authorized/,
    );
    await assert.rejects(
      () => fixtureRepo.addNoLoginOperative({ displayName: 'Pat Doyle', siteIds: [IDS.oak, IDS.riverside] }),
      /not_authorized/,
    );
    assert.equal(
      (await fixtureRepo.companyPeople()).some((person) => person.display_name === 'Pat Doyle'),
      false,
    );
    await assert.rejects(() => fixtureRepo.removeOperativeFromSite(riversideId, IDS.riverside), /not_authorized/);
    const rio = (await fixtureRepo.companyPeople()).find((person) => person.id === riversideId);
    assert.deepEqual(rio?.site_names, ['Plot 4 – Riverside']);
    await assert.rejects(() => fixtureRepo.attachLogin(riversideId, 'rio@sitepack.test'), /not_authorized/);
    await assert.rejects(() => fixtureRepo.attachLogin(unassignedId, 'sam@sitepack.test'), /not_authorized/);
    assert.equal((await fixtureRepo.companyPeople()).find((person) => person.id === riversideId)?.has_login, false);

    await assert.rejects(
      () =>
        fixtureRepo.invitePerson({
          email: 'boss@sitepack.test',
          displayName: 'Boss',
          role: 'cm',
          siteId: IDS.oak,
        }),
      /not_authorized/,
    );
  });

  await t.test('the owner can add a name with no site, and removing the last site keeps the person', async () => {
    resetFixtureStore();
    await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
    await assert.rejects(
      () => fixtureRepo.addNoLoginOperative({ displayName: '   ', siteIds: [] }),
      /name_required/,
    );
    const before = (await fixtureRepo.listCompanyPeople()).length;
    const id = await fixtureRepo.addNoLoginOperative({
      displayName: '  Sam Cole  ',
      trade: '   ',
      siteIds: [IDS.oak],
    });
    assert.equal((await fixtureRepo.listCompanyPeople()).length, before + 1);
    let row = (await fixtureRepo.companyPeople()).find((person) => person.id === id);
    assert.equal(row?.display_name, 'Sam Cole');
    assert.equal(row?.trade, null);
    assert.equal(row?.has_login, false);
    assert.deepEqual(row?.site_names, ['Plot 12 – Oak Estate']);

    await fixtureRepo.removeOperativeFromSite(id, IDS.oak);
    row = (await fixtureRepo.companyPeople()).find((person) => person.id === id);
    assert.ok(row);
    assert.deepEqual(row.site_names, []);
    assert.equal((await fixtureRepo.listCompanyPeople()).some((person) => person.id === id), true);
    assert.equal(
      (await fixtureRepo.listAssignments(IDS.oak)).some((assignment) => assignment.person_id === id),
      false,
    );

    await assert.rejects(() => fixtureRepo.removeOperativeFromSite(IDS.cm, IDS.oak), /not_authorized/);
    assert.equal(
      (await fixtureRepo.listAssignments(IDS.oak)).some((assignment) => assignment.person_id === IDS.cm),
      true,
    );

    const twin = await fixtureRepo.addNoLoginOperative({ displayName: 'Amy Keane', siteIds: [] });
    const twins = (await fixtureRepo.companyPeople()).filter((person) => person.display_name === 'Amy Keane');
    assert.equal(twins.length, 2);
    assert.notEqual(twins[0]?.id, twins[1]?.id);
    assert.notEqual(twin, IDS.amy);
  });

  await t.test('invite attaches the login to the same person', async () => {
    resetFixtureStore();
    await fixtureRepo.signIn('owner@sitepack.test', SEED_PASSWORD);
    const id = await fixtureRepo.addNoLoginOperative({
      displayName: 'Lee Stone',
      trade: 'labourer',
      siteIds: [IDS.oak],
    });
    const before = (await fixtureRepo.listCompanyPeople()).length;

    await assert.rejects(() => fixtureRepo.attachLogin(id, '   '), /email_required/);
    await assert.rejects(() => fixtureRepo.attachLogin(id, 'Amy@Sitepack.test'), /email_in_use/);
    await assert.rejects(() => fixtureRepo.attachLogin(IDS.amy, 'lee.stone@sitepack.test'), /already_has_login/);
    assert.equal((await fixtureRepo.listCompanyPeople()).find((person) => person.id === IDS.amy)?.email, 'amy@sitepack.test');
    assert.equal(
      (await fixtureRepo.listCompanyPeople()).some((person) => person.email === 'lee.stone@sitepack.test'),
      false,
    );

    await fixtureRepo.attachLogin(id, ' Lee.Stone@sitepack.test ');
    const people = await fixtureRepo.listCompanyPeople();
    assert.equal(people.length, before);
    const attached = people.filter((person) => person.email === 'lee.stone@sitepack.test');
    assert.equal(attached.length, 1);
    assert.equal(attached[0]?.id, id);
    assert.equal(attached[0]?.role, 'operative');
    assert.ok(attached[0]?.auth_user_id);
    assert.notEqual(attached[0]?.auth_user_id, id);
    assert.equal((await fixtureRepo.companyPeople()).find((person) => person.id === id)?.has_login, true);

    await fixtureRepo.signOut();
    await fixtureRepo.setPassword(SEED_PASSWORD);
    const session = await fixtureRepo.signIn('lee.stone@sitepack.test', SEED_PASSWORD);
    assert.equal(session.person.id, id);
    assert.equal(session.person.role, 'operative');
    assert.deepEqual(
      (await fixtureRepo.listAssignedSites()).map((site) => site.id),
      [IDS.oak],
    );
    assert.equal(await fixtureRepo.getSite(IDS.riverside), null);
    await assert.rejects(() => fixtureRepo.listDrawings(IDS.warehouse), /not_authorized/);
  });
});

test('the company people migration keeps insert closed and the read narrow', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const v0 = fs.readFileSync('supabase/migrations/20260918120000_sitepack_v0.sql', 'utf8');
  const folders = fs.readFileSync('supabase/migrations/20260922170000_drawing_folders.sql', 'utf8');
  const seat = fs.readFileSync('supabase/migrations/20260923120000_people_seat_shape.sql', 'utf8');

  assert.match(v0, /create policy people_insert_owner/);
  assert.match(folders, /p_folder text default null/);
  assert.match(seat, /revoke insert on table public\.people from authenticated/);
  assert.doesNotMatch(sql, /create policy people_insert/);
  assert.match(sql, /revoke insert on table public\.people from authenticated, anon/);

  const read = sql.slice(sql.indexOf('function public.company_people'), sql.indexOf('function public.add_no_login_operative'));
  const build = read.slice(read.indexOf('jsonb_build_object('), read.indexOf(') as row_data'));
  assert.match(build, /'display_name'/);
  assert.match(build, /'role'/);
  assert.match(build, /'trade'/);
  assert.match(build, /'has_login', p\.auth_user_id is not null/);
  assert.match(build, /'site_names'/);
  assert.match(build, /jsonb_agg\(s\.name order by s\.name\)/);
  assert.match(read, /v_role not in \('cm', 'owner'\)/);
  assert.doesNotMatch(build, /'email'/);
  assert.doesNotMatch(build, /'site_id'/);
  assert.doesNotMatch(build, /'auth_user_id'/);
  assert.doesNotMatch(build, /storage_path/);
  assert.doesNotMatch(build, /drawing/);

  const add = sql.slice(
    sql.indexOf('function public.add_no_login_operative'),
    sql.indexOf('function public.remove_operative_from_site'),
  );
  assert.match(add, /v_company,\s*'operative',\s*v_trade,\s*v_name,\s*null,\s*null/);
  assert.match(add, /raise exception 'name_required'/);
  assert.match(add, /if v_role = 'cm' and cardinality\(v_site_ids\) = 0/);
  assert.match(add, /if v_role = 'cm' and not private\.is_assigned_to_site\(v_site\)/);
  assert.doesNotMatch(add, /p_role/);
  assert.doesNotMatch(add, /p_email/);
  assert.doesNotMatch(add, /p_auth_user_id/);

  const remove = sql.slice(sql.indexOf('function public.remove_operative_from_site'));
  assert.match(remove, /v_person\.role <> 'operative'/);
  assert.match(remove, /if v_role = 'cm' and not private\.is_assigned_to_site\(p_site_id\)/);
  assert.match(remove, /delete from public\.site_assignments/);
  assert.doesNotMatch(remove, /delete from public\.people/);

  const invite = fs.readFileSync('supabase/functions/invite-person/index.ts', 'utf8');
  const attach = invite.slice(invite.indexOf('async function attachLogin'), invite.indexOf('function json'));
  assert.match(attach, /email_required/);
  assert.match(attach, /email_in_use/);
  assert.match(attach, /already_has_login/);
  assert.match(attach, /existing\.role !== 'operative'/);
  assert.match(attach, /auth_user_id: invited\.user\.id, email/);
  assert.match(attach, /\.eq\('id', existing\.id\)/);
  assert.doesNotMatch(attach, /\.insert\(/);
  const created = invite.slice(invite.indexOf('New person invite'), invite.indexOf('async function attachLogin'));
  assert.match(created, /me\.role === 'cm' && role !== 'operative'/);
  assert.match(created, /person_id: created\.id/);

  const screen = fs.readFileSync('app/(app)/people.tsx', 'utf8');
  assert.match(screen, /repo\.companyPeople\(\)/);
  assert.match(screen, /addNoLoginOperative/);
  assert.match(screen, /attachLogin/);
  assert.match(screen, /person\?\.role === 'operative'/);
  assert.doesNotMatch(screen, /router\.push/);
  assert.doesNotMatch(screen, /\/sites\//);
  assert.doesNotMatch(screen, /price/i);
  assert.doesNotMatch(screen, /\.email/);
  const tabs = fs.readFileSync('components/app-tabs.tsx', 'utf8');
  assert.match(tabs, /label: 'People'/);
  assert.match(tabs, /role === 'operative'/);
  assert.doesNotMatch(fs.readFileSync('app/(app)/home.tsx', 'utf8'), /router\.push\('\/people'\)/);
  assert.doesNotMatch(fs.readFileSync('app/(app)/sites/index.tsx', 'utf8'), /router\.push\('\/people'\)/);

  const loadFn = screen.slice(screen.indexOf('const load = useCallback'), screen.indexOf('async function refreshAfterWrite'));
  assert.match(loadFn, /setPeople\(nextPeople\)/);
  assert.match(loadFn, /setLoaded\(true\)/);
  assert.match(loadFn, /setError\(''\)/);

  const focus = screen.slice(screen.indexOf('useFocusEffect('), screen.indexOf("if (person?.role === 'operative')"));
  assert.match(focus, /peopleLoadFailureMessage\(err\)/);
  assert.doesNotMatch(focus, /peopleFailureMessage\(err/);
  assert.doesNotMatch(focus, /setLoaded\(true\)/);
  assert.doesNotMatch(focus, /setPeople\(\[\]\)/);

  const waiting = screen.slice(screen.indexOf('if (!loaded && !error)'), screen.indexOf('const callerRole'));
  assert.match(waiting, /Loading people…/);
  assert.doesNotMatch(waiting, /No one in the company yet/);
  assert.doesNotMatch(waiting, /Add a name/);

  assert.match(screen, /loaded && !error && people\.length === 0 \? <EmptyState title="No one in the company yet" \/>/);
  assert.doesNotMatch(screen, /\{people\.length === 0 \? <EmptyState title="No one in the company yet" \/>/);
  assert.match(screen, /\{loaded \? \(\s*<>\s*<Title>Add a person<\/Title>/);

  const refresh = screen.slice(screen.indexOf('async function refreshAfterWrite'), screen.indexOf('useFocusEffect('));
  assert.match(refresh, /await load\(\)/);
  assert.match(refresh, /peopleLoadFailureMessage\(err\)/);
  assert.match(fs.readFileSync('data/companyPeople.ts', 'utf8'), /message === 'unknown'\) return 'Could not load people\.'/);
  assert.doesNotMatch(refresh, /Could not remove them from that site/);
  assert.doesNotMatch(refresh, /Could not send the invite/);
  assert.doesNotMatch(refresh, /Could not add that name/);

  const handlers: [string, string][] = [
    ['async function onAdd', 'Could not add that name'],
    ['async function onRemove', 'Could not remove them from that site'],
    ['async function onInvite', 'Could not send the invite'],
  ];
  for (const [start, failure] of handlers) {
    const from = screen.indexOf(start);
    const fn = screen.slice(from, screen.indexOf('await refreshAfterWrite()', from) + 'await refreshAfterWrite()'.length);
    const writeTry = fn.slice(fn.indexOf('try {'), fn.indexOf('} catch'));
    assert.equal(writeTry.includes('await load()'), false);
    assert.equal(fn.includes(failure), true);
    assert.equal(fn.includes('return;'), true);
    assert.equal(fn.includes('await refreshAfterWrite()'), true);
  }
});
