-- People groups: operative, contracts manager, company match, anon, idempotent assign.
-- Apply migrations and seed first, then:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/people-groups.sql
-- The script rolls back the rows it adds. It also applies the groups migration again.

begin;

create or replace function pg_temp.ok(cond boolean, message text)
returns void
language plpgsql
as $$
begin
  if coalesce(cond, false) then
    raise notice 'ok: %', message;
  else
    raise exception 'FAIL: %', message;
  end if;
end;
$$;

insert into public.people (id, company_id, role, display_name, email, phone, auth_user_id)
values (
  'dddddddd-dddd-dddd-dddd-ddddddddddd3',
  '11111111-1111-1111-1111-111111111111',
  'operative',
  'Lee Stone',
  null,
  null,
  null
);

insert into public.companies (id, name)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Other Co');

insert into public.people (id, company_id, role, display_name, email, auth_user_id)
values (
  'dddddddd-dddd-dddd-dddd-ddddddddddd1',
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'operative',
  'Pat Other',
  null,
  null
);

insert into public.sites (id, company_id, name)
values (
  'dddddddd-dddd-dddd-dddd-ddddddddddd2',
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'Other Yard'
);

select pg_temp.ok(
  not has_function_privilege('anon', 'public.create_people_group(text)', 'execute')
  and not has_function_privilege('public', 'public.create_people_group(text)', 'execute')
  and has_function_privilege('authenticated', 'public.create_people_group(text)', 'execute')
  and not has_function_privilege('anon', 'public.assign_group_to_sites(uuid, uuid[])', 'execute')
  and not has_function_privilege('public', 'public.assign_group_to_sites(uuid, uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.assign_group_to_sites(uuid, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.remove_group_from_site(uuid, uuid)', 'execute')
  and not has_function_privilege('public', 'public.remove_group_from_site(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.remove_group_from_site(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.rename_people_group(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.delete_people_group(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.set_people_group_members(uuid, uuid[])', 'execute'),
  'group RPCs are authenticated-only'
);

select pg_temp.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) cfg
    where n.nspname = 'public'
      and p.proname = 'assign_group_to_sites'
      and cfg like 'search_path=%'
  ),
  'assign_group_to_sites pins search_path'
);

-- ---------------------------------------------------------------------------
-- Ben, operative. Cannot create or assign.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
begin
  perform public.create_people_group('Oak dryliners');
  raise exception 'FAIL: operative created a group';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: operative cannot create a group';
end $$;

do $$
begin
  perform public.assign_group_to_sites(
    'cccccccc-cccc-cccc-cccc-ccccccccccc1',
    array['66666666-6666-6666-6666-666666666666']::uuid[]
  );
  raise exception 'FAIL: operative assigned a group';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: operative cannot assign a group';
end $$;

select pg_temp.ok(
  (select count(*) from public.people_groups) = 0,
  'operative cannot read groups'
);

reset role;

-- ---------------------------------------------------------------------------
-- Owner creates the crew, including Lee who has no login.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
begin
  perform public.create_people_group('   ');
  raise exception 'FAIL: blank name';
exception
  when others then
    if sqlerrm <> 'name_required' then
      raise;
    end if;
    raise notice 'ok: blank group name is name_required';
end $$;

do $$
begin
  perform public.create_people_group(repeat('a', 41));
  raise exception 'FAIL: long name';
exception
  when others then
    if sqlerrm <> 'name_too_long' then
      raise;
    end if;
    raise notice 'ok: 41 character name is name_too_long';
end $$;

select set_config('app.group_id', public.create_people_group('  Oak dryliners  ')::text, true);

select pg_temp.ok(
  (select name from public.people_groups where id = current_setting('app.group_id')::uuid) = 'Oak dryliners',
  'group name is stored trimmed'
);

do $$
begin
  perform public.create_people_group('oak DRYLINERS');
  raise exception 'FAIL: duplicate name';
exception
  when others then
    if sqlerrm <> 'name_in_use' then
      raise;
    end if;
    raise notice 'ok: group name is unique per company ignoring case';
end $$;

select public.set_people_group_members(
  current_setting('app.group_id')::uuid,
  array[
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555',
    'dddddddd-dddd-dddd-dddd-ddddddddddd3'
  ]::uuid[]
);

select pg_temp.ok(
  (
    select count(*)
    from public.people_group_members
    where group_id = current_setting('app.group_id')::uuid
  ) = 3,
  'owner set three members, including a person with no login'
);

do $$
begin
  perform public.set_people_group_members(
    current_setting('app.group_id')::uuid,
    array[
      '44444444-4444-4444-4444-444444444444',
      'dddddddd-dddd-dddd-dddd-ddddddddddd1'
    ]::uuid[]
  );
  raise exception 'FAIL: cross-company person accepted';
exception
  when others then
    if sqlerrm <> 'person_not_in_company' then
      raise;
    end if;
    raise notice 'ok: cross-company person is rejected';
end $$;

select pg_temp.ok(
  (
    select count(*)
    from public.people_group_members
    where group_id = current_setting('app.group_id')::uuid
  ) = 3,
  'a rejected member list leaves the group unchanged'
);

do $$
begin
  perform public.assign_group_to_sites(
    current_setting('app.group_id')::uuid,
    array['dddddddd-dddd-dddd-dddd-ddddddddddd2']::uuid[]
  );
  raise exception 'FAIL: cross-company site accepted';
exception
  when others then
    if sqlerrm <> 'site_not_found' then
      raise;
    end if;
    raise notice 'ok: cross-company site is rejected';
end $$;

select pg_temp.ok(
  not exists (
    select 1 from public.site_assignments
    where site_id = 'dddddddd-dddd-dddd-dddd-ddddddddddd2'
  ),
  'cross-company site has no assignments'
);

do $$
begin
  insert into public.people_groups (company_id, name)
  values ('11111111-1111-1111-1111-111111111111', 'Direct');
  raise exception 'FAIL: owner inserted a group directly';
exception
  when insufficient_privilege then
    raise notice 'ok: even the owner cannot insert a group except through the RPC';
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Contracts manager. Oak and Warehouse only. Riverside is Amy's site.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
begin
  perform public.create_people_group('CM crew');
  raise exception 'FAIL: contracts manager created a group';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: contracts manager cannot create a group';
end $$;

do $$
begin
  perform public.set_people_group_members(
    current_setting('app.group_id')::uuid,
    array['33333333-3333-3333-3333-333333333333']::uuid[]
  );
  raise exception 'FAIL: contracts manager edited members';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: contracts manager cannot edit members';
end $$;

do $$
begin
  perform public.assign_group_to_sites(
    current_setting('app.group_id')::uuid,
    array['77777777-7777-7777-7777-777777777777']::uuid[]
  );
  raise exception 'FAIL: contracts manager assigned Riverside';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: contracts manager cannot assign a group onto a site they are not on';
end $$;

reset role;

select pg_temp.ok(
  not exists (
    select 1
    from public.site_assignments
    where site_id = '77777777-7777-7777-7777-777777777777'
      and person_id = 'dddddddd-dddd-dddd-dddd-ddddddddddd3'
  )
  and exists (
    select 1
    from public.site_assignments
    where site_id = '77777777-7777-7777-7777-777777777777'
      and person_id = '44444444-4444-4444-4444-444444444444'
  ),
  'Riverside still has Amy only from before, not Lee'
);

set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.people_groups) = 1,
  'contracts manager can read the company group'
);

reset role;

-- ---------------------------------------------------------------------------
-- Owner assigns Oak and Warehouse in one action. Repeat is a no-op.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select pg_temp.ok(
  (public.assign_group_to_sites(
    current_setting('app.group_id')::uuid,
    array[
      '66666666-6666-6666-6666-666666666666',
      '88888888-8888-8888-8888-888888888888',
      '66666666-6666-6666-6666-666666666666'
    ]::uuid[]
  )->>'added')::int = 4,
  'first assign adds Lee to Oak and Amy, Ben, and Lee to Warehouse'
);

select pg_temp.ok(
  (public.assign_group_to_sites(
    current_setting('app.group_id')::uuid,
    array[
      '66666666-6666-6666-6666-666666666666',
      '88888888-8888-8888-8888-888888888888'
    ]::uuid[]
  )->>'added')::int = 0,
  'assign is idempotent'
);

select pg_temp.ok(
  exists (
    select 1 from public.site_assignments
    where site_id = '88888888-8888-8888-8888-888888888888'
      and person_id = 'dddddddd-dddd-dddd-dddd-ddddddddddd3'
  )
  and not exists (
    select 1 from public.site_assignments
    where site_id = '77777777-7777-7777-7777-777777777777'
      and person_id = '55555555-5555-5555-5555-555555555555'
  ),
  'Warehouse gained the crew and Riverside did not gain Ben'
);

select pg_temp.ok(
  (public.remove_group_from_site(
    current_setting('app.group_id')::uuid,
    '66666666-6666-6666-6666-666666666666'
  )->>'removed')::int = 1,
  'remove drops only Lee, the person this group added to Oak'
);

select pg_temp.ok(
  (
    select count(*)
    from public.site_assignments
    where site_id = '66666666-6666-6666-6666-666666666666'
      and person_id in (
        '44444444-4444-4444-4444-444444444444',
        '55555555-5555-5555-5555-555555555555',
        '33333333-3333-3333-3333-333333333333'
      )
  ) = 3
  and not exists (
    select 1 from public.site_assignments
    where site_id = '66666666-6666-6666-6666-666666666666'
      and person_id = 'dddddddd-dddd-dddd-dddd-ddddddddddd3'
  )
  and exists (
    select 1 from public.site_assignments
    where site_id = '77777777-7777-7777-7777-777777777777'
      and person_id = '44444444-4444-4444-4444-444444444444'
  )
  and exists (
    select 1 from public.site_assignments
    where site_id = '88888888-8888-8888-8888-888888888888'
      and person_id = 'dddddddd-dddd-dddd-dddd-ddddddddddd3'
  )
  and exists (
    select 1 from public.people where id = 'dddddddd-dddd-dddd-dddd-ddddddddddd3'
  ),
  'a manual assignee survives the group being removed, and other sites stay'
);

-- Two groups on Warehouse. Lee is already covered by the first group.
select set_config('app.group_b', public.create_people_group('Second crew')::text, true);

select public.set_people_group_members(
  current_setting('app.group_b')::uuid,
  array['dddddddd-dddd-dddd-dddd-ddddddddddd3']::uuid[]
);

select pg_temp.ok(
  (public.assign_group_to_sites(
    current_setting('app.group_b')::uuid,
    array['88888888-8888-8888-8888-888888888888']::uuid[]
  )->>'added')::int = 0,
  'a second group links Lee without inserting another assignment'
);

reset role;

select pg_temp.ok(
  (
    select count(*)
    from public.site_assignment_groups sag
    join public.site_assignments a on a.id = sag.site_assignment_id
    where a.site_id = '88888888-8888-8888-8888-888888888888'
      and a.person_id = 'dddddddd-dddd-dddd-dddd-ddddddddddd3'
  ) = 2,
  'Lee on Warehouse is covered by both groups'
);

set local role authenticated;

select pg_temp.ok(
  (public.remove_group_from_site(
    current_setting('app.group_id')::uuid,
    '88888888-8888-8888-8888-888888888888'
  )->>'removed')::int = 2,
  'removing one group drops only the people that group alone added'
);

select pg_temp.ok(
  exists (
    select 1 from public.site_assignments
    where site_id = '88888888-8888-8888-8888-888888888888'
      and person_id = 'dddddddd-dddd-dddd-dddd-ddddddddddd3'
  )
  and not exists (
    select 1 from public.site_assignments
    where site_id = '88888888-8888-8888-8888-888888888888'
      and person_id in (
        '44444444-4444-4444-4444-444444444444',
        '55555555-5555-5555-5555-555555555555'
      )
  )
  and exists (
    select 1 from public.site_assignments
    where site_id = '88888888-8888-8888-8888-888888888888'
      and person_id = '33333333-3333-3333-3333-333333333333'
  )
  and exists (
    select 1 from public.site_assignments
    where site_id = '77777777-7777-7777-7777-777777777777'
      and person_id = '44444444-4444-4444-4444-444444444444'
  )
  and exists (
    select 1 from public.site_assignments
    where site_id = '66666666-6666-6666-6666-666666666666'
      and person_id = '44444444-4444-4444-4444-444444444444'
  ),
  'removing a group leaves other sites and the person the other group still covers'
);

reset role;

select pg_temp.ok(
  exists (
    select 1
    from public.site_assignment_groups sag
    join public.site_assignments a on a.id = sag.site_assignment_id
    where sag.group_id = current_setting('app.group_b')::uuid
      and a.person_id = 'dddddddd-dddd-dddd-dddd-ddddddddddd3'
      and a.site_id = '88888888-8888-8888-8888-888888888888'
  )
  and not exists (
    select 1
    from public.site_assignment_groups sag
    join public.site_assignments a on a.id = sag.site_assignment_id
    where sag.group_id = current_setting('app.group_id')::uuid
      and a.site_id = '88888888-8888-8888-8888-888888888888'
  ),
  'the other group source stays and the removed group source is gone'
);

set local role authenticated;

select pg_temp.ok(
  (public.remove_group_from_site(
    current_setting('app.group_b')::uuid,
    '88888888-8888-8888-8888-888888888888'
  )->>'removed')::int = 1,
  'removing the second group drops Lee'
);

select pg_temp.ok(
  not exists (
    select 1 from public.site_assignments
    where site_id = '88888888-8888-8888-8888-888888888888'
      and person_id = 'dddddddd-dddd-dddd-dddd-ddddddddddd3'
  )
  and exists (
    select 1 from public.site_assignments
    where site_id = '88888888-8888-8888-8888-888888888888'
      and person_id = '33333333-3333-3333-3333-333333333333'
  ),
  'Lee is gone from Warehouse and the contracts manager stays'
);

select set_config('app.group_c', public.create_people_group('Kept crew')::text, true);

select public.set_people_group_members(
  current_setting('app.group_c')::uuid,
  array['dddddddd-dddd-dddd-dddd-ddddddddddd3']::uuid[]
);

select pg_temp.ok(
  (public.assign_group_to_sites(
    current_setting('app.group_c')::uuid,
    array['77777777-7777-7777-7777-777777777777']::uuid[]
  )->>'added')::int = 1,
  'a group can add Lee to Riverside'
);

select public.delete_people_group(current_setting('app.group_c')::uuid);

select pg_temp.ok(
  exists (
    select 1 from public.site_assignments
    where site_id = '77777777-7777-7777-7777-777777777777'
      and person_id = 'dddddddd-dddd-dddd-dddd-ddddddddddd3'
  ),
  'deleting a group keeps the assignments'
);

reset role;

select pg_temp.ok(
  not exists (
    select 1 from public.site_assignment_groups
    where group_id = current_setting('app.group_c')::uuid
  ),
  'deleting a group drops its source links and the row is manual from then on'
);

set local role authenticated;

select set_config('app.group_d', public.create_people_group('Leaders')::text, true);

select public.set_people_group_members(
  current_setting('app.group_d')::uuid,
  array[
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333'
  ]::uuid[]
);

select pg_temp.ok(
  (public.assign_group_to_sites(
    current_setting('app.group_d')::uuid,
    array['88888888-8888-8888-8888-888888888888']::uuid[]
  )->>'added')::int = 1,
  'the group adds the owner to Warehouse and leaves the contracts manager unmarked'
);

select pg_temp.ok(
  (public.remove_group_from_site(
    current_setting('app.group_d')::uuid,
    '88888888-8888-8888-8888-888888888888'
  )->>'removed')::int = 0,
  'removing a group deletes no owner or contracts manager rows'
);

select pg_temp.ok(
  exists (
    select 1 from public.site_assignments
    where site_id = '88888888-8888-8888-8888-888888888888'
      and person_id = '22222222-2222-2222-2222-222222222222'
  )
  and exists (
    select 1 from public.site_assignments
    where site_id = '88888888-8888-8888-8888-888888888888'
      and person_id = '33333333-3333-3333-3333-333333333333'
  ),
  'the owner and the contracts manager stay on Warehouse'
);

reset role;

insert into public.sites (id, company_id, name)
values (
  'dddddddd-dddd-dddd-dddd-ddddddddddd4',
  '11111111-1111-1111-1111-111111111111',
  'CM yard'
);

set local role authenticated;

select set_config('app.group_e', public.create_people_group('CM yard gang')::text, true);

select public.set_people_group_members(
  current_setting('app.group_e')::uuid,
  array['33333333-3333-3333-3333-333333333333']::uuid[]
);

select public.assign_group_to_sites(
  current_setting('app.group_e')::uuid,
  array['dddddddd-dddd-dddd-dddd-ddddddddddd4']::uuid[]
);

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);

select pg_temp.ok(
  (public.remove_group_from_site(
    current_setting('app.group_e')::uuid,
    'dddddddd-dddd-dddd-dddd-ddddddddddd4'
  )->>'removed')::int = 0,
  'the contracts manager who removes the group is not deleted'
);

select pg_temp.ok(
  exists (
    select 1 from public.site_assignments
    where site_id = 'dddddddd-dddd-dddd-dddd-ddddddddddd4'
      and person_id = '33333333-3333-3333-3333-333333333333'
  ),
  'the contracts manager who removes the group keeps their own access'
);

reset role;

do $$
begin
  insert into public.people_group_members (group_id, person_id)
  values (current_setting('app.group_id')::uuid, 'dddddddd-dddd-dddd-dddd-ddddddddddd1');
  raise exception 'FAIL: trigger allowed a cross-company member';
exception
  when others then
    if sqlerrm <> 'person_not_in_company' then
      raise;
    end if;
    raise notice 'ok: trigger rejects a cross-company member';
end $$;

-- Second apply. create or replace, drop policy if exists, drop constraint if exists.
\ir ../supabase/migrations/20261021193000_people_groups.sql

select pg_temp.ok(
  has_function_privilege('authenticated', 'public.assign_group_to_sites(uuid, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.assign_group_to_sites(uuid, uuid[])', 'execute')
  and not has_table_privilege('authenticated', 'public.site_assignment_groups', 'select')
  and not has_table_privilege('anon', 'public.site_assignment_groups', 'insert')
  and not has_table_privilege('public', 'public.site_assignment_groups', 'select')
  and exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'site_assignment_groups'
      and c.relrowsecurity
  )
  and exists (
    select 1 from public.people_groups where id = current_setting('app.group_id')::uuid
  ),
  'the people groups migration applies a second time'
);

rollback;
