-- People visibility, anon RPC, and pinned search_path.
-- Apply migrations and seed first (supabase db reset), then:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/pre-lad-security.sql
-- The script rolls back the rows it adds.

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

-- Extra crew so each role has someone they must not see.
-- Rio: Riverside only. Sam: no site. Nia: Warehouse only.
insert into public.people (id, company_id, role, display_name, email, phone)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111', 'operative', 'Rio Kent', 'rio@sitepack.test', '07000000001'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '11111111-1111-1111-1111-111111111111', 'operative', 'Sam Cole', null, '07000000002'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', '11111111-1111-1111-1111-111111111111', 'operative', 'Nia Ward', 'nia@sitepack.test', '07000000003');

insert into public.site_assignments (site_id, person_id)
values
  ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  ('88888888-8888-8888-8888-888888888888', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');

update public.people
set phone = '07000000999'
where id = '44444444-4444-4444-4444-444444444444';

-- ---------------------------------------------------------------------------
-- Advisors: mutable search_path on the five private helpers, and anon execute
-- on site_contracts_manager_names.
-- ---------------------------------------------------------------------------

select pg_temp.ok(
  (
    select count(*) = 5
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('try_uuid', 'touch_updated_at', 'storage_site_id', 'storage_company_id', 'guard_site_archive')
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  ),
  'five private helpers have search_path pinned'
);

select pg_temp.ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('try_uuid', 'touch_updated_at', 'storage_site_id', 'storage_company_id', 'guard_site_archive')
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  ),
  'no mutable search_path left on those five functions'
);

select pg_temp.ok(
  not has_function_privilege('anon', 'public.site_contracts_manager_names(uuid)', 'execute')
  and not has_function_privilege('public', 'public.site_contracts_manager_names(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.site_contracts_manager_names(uuid)', 'execute'),
  'site_contracts_manager_names is authenticated-only'
);

select pg_temp.ok(
  not has_column_privilege('authenticated', 'public.people', 'email', 'select')
  and not has_column_privilege('authenticated', 'public.people', 'phone', 'select')
  and has_column_privilege('authenticated', 'public.people', 'display_name', 'select')
  and not has_table_privilege('anon', 'public.people_directory', 'select')
  and has_table_privilege('authenticated', 'public.people_directory', 'select'),
  'email and phone are not selectable; the directory is'
);

select pg_temp.ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'people_directory'
      and column_name in ('email', 'phone')
  ),
  'people_directory has no email or phone column'
);

-- ---------------------------------------------------------------------------
-- Ben, operative on Oak only.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select pg_temp.ok(
  (
    select coalesce(array_agg(id order by id), '{}')
    from public.people_directory
  ) = array[
    '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555'
  ]::uuid[],
  'ben lists himself, Amy, and the contracts manager'
);

select pg_temp.ok(
  position('07000000999' in coalesce((select string_agg(row_to_json(d)::text, '') from public.people_directory d), '')) = 0
  and position('amy@sitepack.test' in coalesce((select string_agg(row_to_json(d)::text, '') from public.people_directory d), '')) = 0,
  'ben''s directory payload has no email or phone'
);

select pg_temp.ok(
  (public.my_person()->>'id') = '55555555-5555-5555-5555-555555555555'
  and (public.my_person()->>'email') = 'ben@sitepack.test'
  and (public.my_person()->>'phone') is null
  and position('07000000999' in public.my_person()::text) = 0,
  'ben reads only his own contact fields'
);

do $$
begin
  perform email from public.people;
  raise exception 'FAIL: ben selected email';
exception
  when insufficient_privilege then
    raise notice 'ok: ben cannot select people.email';
end $$;

do $$
begin
  perform phone from public.people;
  raise exception 'FAIL: ben selected phone';
exception
  when insufficient_privilege then
    raise notice 'ok: ben cannot select people.phone';
end $$;

do $$
begin
  perform public.company_people();
  raise exception 'FAIL: operative opened the labour list';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: operative company_people is not_authorized';
end $$;

do $$
begin
  perform public.site_contracts_manager_names('77777777-7777-7777-7777-777777777777');
  raise exception 'FAIL: ben read riverside contracts managers';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: ben cannot read contracts managers off his site';
end $$;

select pg_temp.ok(
  public.site_contracts_manager_names('66666666-6666-6666-6666-666666666666') = '["Priya Shah"]'::jsonb,
  'ben can read the contracts manager on Oak'
);

select pg_temp.ok(
  private.try_uuid('not-a-uuid') is null
  and private.try_uuid('66666666-6666-6666-6666-666666666666') = '66666666-6666-6666-6666-666666666666'::uuid
  and private.storage_company_id('11111111-1111-1111-1111-111111111111/66666666-6666-6666-6666-666666666666/file.pdf')
    = '11111111-1111-1111-1111-111111111111'::uuid
  and private.storage_site_id('11111111-1111-1111-1111-111111111111/66666666-6666-6666-6666-666666666666/file.pdf')
    = '66666666-6666-6666-6666-666666666666'::uuid,
  'pinned storage helpers still parse a drawings path'
);

do $$
begin
  perform public.replace_drawing(
    p_site_id => '66666666-6666-6666-6666-666666666666',
    p_title => 'Probe sheet',
    p_revision => 'A',
    p_storage_path => '11111111-1111-1111-1111-111111111111/66666666-6666-6666-6666-666666666666/probe.pdf'
  );
  raise exception 'FAIL: operative replaced a drawing';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: operative cannot replace a drawing';
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Amy is on Oak and Riverside, so she also sees Rio. Not Nia, Sam, or the owner.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select pg_temp.ok(
  (
    select coalesce(array_agg(id order by id), '{}')
    from public.people_directory
  ) = array[
    '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
  ]::uuid[],
  'amy lists Oak crew plus Rio on Riverside'
);

select pg_temp.ok(
  (public.my_person()->>'email') = 'amy@sitepack.test'
  and (public.my_person()->>'phone') = '07000000999',
  'amy still reads her own email and phone'
);

reset role;

-- ---------------------------------------------------------------------------
-- Contracts manager: Oak and Warehouse. Not Rio, Sam, or the owner.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select pg_temp.ok(
  (
    select coalesce(array_agg((value->>'id')::uuid order by value->>'id'), '{}')
    from jsonb_array_elements(public.company_people()) value
  ) = array[
    '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'
  ]::uuid[],
  'contracts manager labour list is the shared sites only'
);

select pg_temp.ok(
  (
    select value->'site_names'
    from jsonb_array_elements(public.company_people()) value
    where value->>'id' = '44444444-4444-4444-4444-444444444444'
  ) = '["Plot 12 – Oak Estate", "Plot 4 – Riverside"]'::jsonb,
  'a shared person still shows a site name the contracts manager is not on'
);

select pg_temp.ok(
  position('email' in public.company_people()::text) = 0
  and position('07000000001' in public.company_people()::text) = 0,
  'labour list has no email or phone'
);

do $$
begin
  update public.sites
  set archived_at = now()
  where id = '66666666-6666-6666-6666-666666666666';
  raise exception 'FAIL: contracts manager archived a site';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: guard_site_archive still blocks a contracts manager';
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Owner: the whole company, assign Sam, replace a drawing.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.people_directory) = 7
  and (
    select count(*) from jsonb_array_elements(public.company_people())
  ) = 7,
  'owner lists all seven people'
);

select pg_temp.ok(
  (public.my_person()->>'email') = 'owner@sitepack.test',
  'owner reads their own email'
);

insert into public.site_assignments (site_id, person_id)
values ('66666666-6666-6666-6666-666666666666', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2');

select pg_temp.ok(
  exists (
    select 1
    from public.site_assignments
    where site_id = '66666666-6666-6666-6666-666666666666'
      and person_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
  ),
  'owner assigns an unassigned person to Oak'
);

select pg_temp.ok(
  (public.replace_drawing(
    p_site_id => '66666666-6666-6666-6666-666666666666',
    p_title => 'Probe sheet',
    p_revision => 'A',
    p_storage_path => '11111111-1111-1111-1111-111111111111/66666666-6666-6666-6666-666666666666/probe.pdf',
    p_folder => 'Other'
  )->>'is_current')::boolean,
  'owner uploads a drawing'
);

update public.sites
set name = 'Plot 12 – Oak Estate'
where id = '66666666-6666-6666-6666-666666666666';

select pg_temp.ok(
  (select updated_at > now() - interval '1 minute' from public.sites where id = '66666666-6666-6666-6666-666666666666'),
  'touch_updated_at still runs for the owner'
);

reset role;

-- Ben now shares Oak with Sam, and still cannot see Sam's phone.
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select pg_temp.ok(
  exists (
    select 1 from public.people_directory where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
  )
  and position('07000000002' in (select string_agg(row_to_json(d)::text, '') from public.people_directory d)) = 0,
  'after the assign, ben sees Sam and not Sam''s phone'
);

reset role;

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------

set local role anon;

do $$
begin
  perform public.site_contracts_manager_names('66666666-6666-6666-6666-666666666666');
  raise exception 'FAIL: anon executed site_contracts_manager_names';
exception
  when insufficient_privilege then
    raise notice 'ok: anon site_contracts_manager_names is permission denied';
end $$;

do $$
begin
  perform id from public.people_directory;
  raise exception 'FAIL: anon read the directory';
exception
  when insufficient_privilege then
    raise notice 'ok: anon cannot read people_directory';
end $$;

reset role;

rollback;
