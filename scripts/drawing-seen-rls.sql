-- Drawing-seen RLS. Apply scripts/throwaway-auth.sql and every migration first.
--   DATABASE_URL=postgres://postgres@127.0.0.1/sitepack_seen bash scripts/run-drawing-seen-rls.sh
-- The checks roll back. Nothing here is a hosted project.

\set ON_ERROR_STOP on
\set firmx 'c1111111-1111-4111-8111-111111111111'
\set firmy 'c2222222-2222-4222-8222-222222222222'
\set ownerx 'a1111111-1111-4111-8111-111111111111'
\set cmx 'a1111111-1111-4111-8111-111111111112'
\set opa 'a1111111-1111-4111-8111-111111111113'
\set opb 'a1111111-1111-4111-8111-111111111114'
\set opc 'a1111111-1111-4111-8111-111111111115'
\set ownery 'a2222222-2222-4222-8222-222222222221'
\set sitea '51111111-1111-4111-8111-111111111111'
\set siteb '51111111-1111-4111-8111-111111111112'
\set sitey '52222222-2222-4222-8222-222222222221'
\set drawb 'd1111111-1111-4111-8111-111111111111'
\set drawc 'd1111111-1111-4111-8111-111111111112'
\set drawy 'd2222222-2222-4222-8222-222222222221'
\set drawd 'd1111111-1111-4111-8111-111111111113'
\set drawe 'd1111111-1111-4111-8111-111111111114'

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

create or replace function pg_temp.jwt(p_sub uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_sub::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function pg_temp.fails(p_sql text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception
  when others then
    return true;
end;
$$;

create or replace function pg_temp.raises(p_sql text, p_message text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception
  when others then
    return sqlerrm = p_message;
end;
$$;

select pg_temp.ok(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'record_drawing_open',
        'confirm_drawing_seen',
        'my_drawing_proof',
        'my_unseen_drawings',
        'site_drawing_seen',
        'drawing_seen_roster',
        'manager_drawing_gaps',
        'site_not_seen'
      )
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
        where c like 'search_path=%'
      )
  ) = 8,
  'drawing seen functions pin search_path'
);

select pg_temp.ok(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname in ('record_drawing_open', 'confirm_drawing_seen')
  ) = 2
  and not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'my_drawing_proof',
        'my_unseen_drawings',
        'site_drawing_seen',
        'drawing_seen_roster',
        'manager_drawing_gaps',
        'site_not_seen'
      )
      and p.prosecdef
  ),
  'writes are security definer and reads run as the caller'
);

select pg_temp.ok(
  not has_function_privilege('anon', 'public.confirm_drawing_seen(uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.record_drawing_open(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.my_drawing_proof(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.my_unseen_drawings()', 'execute')
  and not has_function_privilege('anon', 'public.site_drawing_seen(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.drawing_seen_roster(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.manager_drawing_gaps()', 'execute')
  and not has_function_privilege('anon', 'public.site_not_seen(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.drawing_seen_person()', 'execute')
  and not has_function_privilege('anon', 'private.drawing_proof_site_matches()', 'execute')
  and not has_table_privilege('anon', 'public.drawing_seen', 'select')
  and not has_table_privilege('anon', 'public.drawing_revision_opens', 'select')
  and not has_table_privilege('authenticated', 'public.drawing_seen', 'insert')
  and not has_table_privilege('authenticated', 'public.drawing_seen', 'update')
  and not has_table_privilege('authenticated', 'public.drawing_revision_opens', 'insert')
  and has_table_privilege('authenticated', 'public.drawing_seen', 'select'),
  'anon cannot call drawing seen functions and clients cannot write the tables directly'
);

set local role anon;

do $$
begin
  perform public.confirm_drawing_seen('00000000-0000-4000-8000-000000000099');
  raise exception 'FAIL: anon called confirm_drawing_seen';
exception
  when insufficient_privilege then
    raise notice 'ok: anon cannot call confirm_drawing_seen';
end $$;

reset role;

select pg_temp.ok(
  (
    select count(*)
    from pg_policies
    where policyname in ('drawing_seen_select', 'drawing_revision_opens_select')
      and cmd = 'SELECT'
  ) = 2
  and not exists (
    select 1
    from pg_policies
    where tablename in ('drawing_seen', 'drawing_revision_opens')
      and cmd <> 'SELECT'
  ),
  'select policies only'
);

insert into auth.users (id, email)
values
  (:'ownerx', 'ownerx@firmx.test'),
  (:'cmx', 'cmx@firmx.test'),
  (:'opa', 'opa@firmx.test'),
  (:'opb', 'opb@firmx.test'),
  (:'opc', 'opc@firmx.test'),
  (:'ownery', 'ownery@firmy.test');

insert into public.companies (id, name)
values
  (:'firmx', 'Firm X'),
  (:'firmy', 'Firm Y');

insert into public.people (id, auth_user_id, company_id, role, display_name, email)
values
  (:'ownerx', :'ownerx', :'firmx', 'owner', 'Owner X', 'ownerx@firmx.test'),
  (:'cmx', :'cmx', :'firmx', 'cm', 'CM X', 'cmx@firmx.test'),
  (:'opa', :'opa', :'firmx', 'operative', 'Op A', 'opa@firmx.test'),
  (:'opb', :'opb', :'firmx', 'operative', 'Op B', 'opb@firmx.test'),
  (:'opc', :'opc', :'firmx', 'operative', 'Op C', 'opc@firmx.test'),
  (:'ownery', :'ownery', :'firmy', 'owner', 'Owner Y', 'ownery@firmy.test');

insert into public.sites (id, company_id, name)
values
  (:'sitea', :'firmx', 'Site A'),
  (:'siteb', :'firmx', 'Site B'),
  (:'sitey', :'firmy', 'Site Y');

insert into public.site_assignments (site_id, person_id)
values
  (:'sitea', :'cmx'),
  (:'sitea', :'opa'),
  (:'sitea', :'opc'),
  (:'siteb', :'opb');

insert into public.drawings (id, site_id, title, sheet_number, revision, is_current, storage_path, uploaded_by)
values
  (:'drawb', :'sitea', 'Ground Floor GA', 'A-101', 'B', true, :'firmx' || '/' || :'sitea' || '/b.pdf', :'ownerx'),
  (:'drawy', :'sitey', 'Yard', 'Y-01', 'A', true, :'firmy' || '/' || :'sitey' || '/y.pdf', :'ownery');

select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.confirm_drawing_seen(''' || :'drawb' || ''')',
    'not_opened'
  ),
  'cannot confirm a revision that has not been opened'
);

select pg_temp.ok(
  pg_temp.fails(
    'insert into public.drawing_seen (drawing_id, site_id, person_id, revision) values ('''
    || :'drawb' || ''', ''' || :'sitea' || ''', ''' || :'opa' || ''', ''B'')'
  ),
  'operative cannot insert a confirmation directly'
);

select public.record_drawing_open(:'drawb'::uuid);
select public.confirm_drawing_seen(
  :'drawb'::uuid,
  (
    select o.opened_at + interval '1 minute'
    from public.drawing_revision_opens o
    where o.drawing_id = :'drawb'::uuid
      and o.person_id = :'opa'::uuid
  )
);

select pg_temp.ok(
  (select count(*) from public.drawing_seen) = 1
  and (select revision from public.drawing_seen) = 'B'
  and (select person_id from public.drawing_seen) = :'opa'::uuid
  and (select s.seen_at from public.drawing_seen s where s.person_id = :'opa'::uuid)
    = (
      select o.opened_at + interval '1 minute'
      from public.drawing_revision_opens o
      where o.drawing_id = :'drawb'::uuid
        and o.person_id = :'opa'::uuid
    )
  and (select s.seen_at <> s.received_at from public.drawing_seen s where s.person_id = :'opa'::uuid),
  'the device tap time is stored as seen_at and received_at stays the server time'
);

select public.confirm_drawing_seen(:'drawb'::uuid, now() + interval '6 minutes');

select pg_temp.ok(
  (select s.seen_at from public.drawing_seen s where s.person_id = :'opa'::uuid and s.drawing_id = :'drawb'::uuid)
    = (
      select o.opened_at + interval '1 minute'
      from public.drawing_revision_opens o
      where o.drawing_id = :'drawb'::uuid
        and o.person_id = :'opa'::uuid
    ),
  'a later tap does not replace the first seen_at'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.record_drawing_open(''' || :'drawy' || ''')',
    'drawing_not_found'
  ),
  'operative of site A cannot open firm Y'
);

select pg_temp.ok(
  (select count(*) from public.drawing_seen where site_id = :'sitey'::uuid) = 0,
  'operative of site A cannot read firm Y confirmations'
);

select pg_temp.ok(
  pg_temp.raises('select public.site_drawing_seen(''' || :'sitea' || ''')', 'not_authorized'),
  'operative cannot open the owner roster'
);

reset role;
select pg_temp.jwt(:'opc'::uuid);
set local role authenticated;

select public.record_drawing_open(:'drawb'::uuid);
select public.confirm_drawing_seen(:'drawb'::uuid);

reset role;
select pg_temp.jwt(:'opb'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.drawing_seen) = 0
  and (select count(*) from public.drawing_revision_opens) = 0,
  'operative of site B cannot read site A confirmations'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.record_drawing_open(''' || :'drawb' || ''')',
    'drawing_not_found'
  )
  and pg_temp.raises(
    'select public.record_drawing_open(''00000000-0000-4000-8000-000000000099'')',
    'drawing_not_found'
  )
  and pg_temp.raises(
    'select public.confirm_drawing_seen(''' || :'drawb' || ''')',
    'drawing_not_found'
  )
  and pg_temp.raises(
    'select public.confirm_drawing_seen(''00000000-0000-4000-8000-000000000099'')',
    'drawing_not_found'
  ),
  'an outsider gets drawing_not_found for a drawing that exists'
);

reset role;
select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.drawing_seen) = 0
  and pg_temp.raises('select public.site_drawing_seen(''' || :'sitea' || ''')', 'not_authorized')
  and pg_temp.raises('select public.drawing_seen_roster(''' || :'drawb' || ''')', 'drawing_not_found')
  and pg_temp.raises(
    'select public.confirm_drawing_seen(''' || :'drawb' || ''')',
    'drawing_not_found'
  ),
  'firm Y cannot read firm X confirmations'
);

reset role;
select pg_temp.jwt(:'cmx'::uuid);
set local role authenticated;

select public.record_drawing_open(:'drawb'::uuid);
select public.confirm_drawing_seen(:'drawb'::uuid);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select (public.drawing_seen_roster(:'drawb'::uuid)->>'seen_count')::int) = 2
  and (select (public.drawing_seen_roster(:'drawb'::uuid)->>'assigned_count')::int) = 2
  and (select (public.site_drawing_seen(:'sitea'::uuid)->>'assigned_count')::int) = 2
  and not exists (
    select 1
    from jsonb_array_elements((public.drawing_seen_roster(:'drawb'::uuid))->'seen') person
    where person->>'person_id' = :'cmx'
  )
  and not exists (
    select 1
    from jsonb_array_elements((public.drawing_seen_roster(:'drawb'::uuid))->'unseen') person
    where person->>'person_id' = :'cmx'
  )
  and (select count(*) from public.drawing_seen where person_id = :'cmx'::uuid) = 1
  and not exists (
    select 1 from public.drawing_seen where site_id = :'sitey'::uuid
  ),
  'the count is operatives only and a contracts manager does not count'
);

delete from public.site_assignments
where site_id = :'sitea'::uuid
  and person_id = :'opc'::uuid;

select pg_temp.ok(
  (select (public.drawing_seen_roster(:'drawb'::uuid)->>'seen_count')::int) = 1
  and (select (public.drawing_seen_roster(:'drawb'::uuid)->>'assigned_count')::int) = 1
  and (select count(*) from public.drawing_seen where person_id = :'opc'::uuid) = 1,
  'removed people drop out of N and their confirmation is kept'
);

select public.replace_drawing(
  :'sitea'::uuid,
  'Ground Floor GA',
  'C',
  :'firmx' || '/' || :'sitea' || '/c.pdf',
  'A-101',
  '2026-10-22'::date,
  1200,
  'application/pdf',
  :'drawb'::uuid,
  :'drawc'::uuid,
  'Ground floor',
  'Ground'
);

select pg_temp.ok(
  (select (public.site_drawing_seen(:'sitea'::uuid)->>'not_seen_by_everyone')::int) = 1
  and (
    select (item->>'seen_count')::int
    from jsonb_array_elements((public.site_drawing_seen(:'sitea'::uuid))->'drawings') item
    where item->>'drawing_id' = :'drawc'
  ) = 0
  and (select (public.site_drawing_seen(:'sitea'::uuid)->>'assigned_count')::int) = 1
  and (select count(*) from public.drawing_seen where drawing_id = :'drawb'::uuid and revision = 'B') = 3,
  'replacing rev B with C resets the count to 0 of N and keeps history'
);

select pg_temp.ok(
  (select jsonb_array_length(public.site_not_seen(:'sitea'::uuid))) = 1
  and exists (
    select 1
    from jsonb_array_elements(public.site_not_seen(:'sitea'::uuid)) person
    where person->>'person_id' = :'opa'
      and jsonb_array_length(person->'sheets') = 1
  )
  and not exists (
    select 1
    from jsonb_array_elements(public.site_not_seen(:'sitea'::uuid)) person
    where person->>'person_id' = :'cmx'
  ),
  'not seen yet lists operatives only'
);

reset role;
select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.confirm_drawing_seen(''' || :'drawc' || ''')',
    'not_opened'
  ),
  'a confirmation of rev B does not open rev C'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.confirm_drawing_seen(''' || :'drawb' || ''')',
    'not_current'
  ),
  'cannot confirm a superseded revision'
);

select public.record_drawing_open(:'drawc'::uuid);
select public.confirm_drawing_seen(
  :'drawc'::uuid,
  (
    select o.opened_at + interval '1 minute'
    from public.drawing_revision_opens o
    where o.drawing_id = :'drawc'::uuid
      and o.person_id = :'opa'::uuid
  )
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (
    select (item->>'seen_count')::int
    from jsonb_array_elements((public.site_drawing_seen(:'sitea'::uuid))->'drawings') item
    where item->>'drawing_id' = :'drawc'
  ) = 1
  and exists (
    select 1
    from jsonb_array_elements((public.drawing_seen_roster(:'drawc'::uuid))->'seen') person
    where person->>'person_id' = :'opa'
      and (person->>'seen_at')::timestamptz = (
        select o.opened_at + interval '1 minute'
        from public.drawing_revision_opens o
        where o.drawing_id = :'drawc'::uuid
          and o.person_id = :'opa'::uuid
      )
  ),
  'the who-list shows the device tap time for the current rev'
);

select pg_temp.ok(
  not exists (
    select 1
    from jsonb_array_elements(public.manager_drawing_gaps()) item
    where item->>'site_id' = :'sitea'
  ),
  'a contracts manager who has not seen the rev does not leave the site on the gap list'
);

reset role;

select pg_temp.ok(
  (select count(*) from public.drawing_seen where drawing_id = :'drawb'::uuid) = 3
  and (select count(*) from public.drawing_seen where drawing_id = :'drawc'::uuid) = 1,
  'history rows remain after the transaction checks'
);

reset role;

insert into public.drawings (id, site_id, title, sheet_number, revision, is_current, storage_path, uploaded_by)
values
  (:'drawd', :'sitea', 'Future tap', 'A-201', 'A', true, :'firmx' || '/' || :'sitea' || '/d.pdf', :'ownerx'),
  (:'drawe', :'sitea', 'Early tap', 'A-202', 'A', true, :'firmx' || '/' || :'sitea' || '/e.pdf', :'ownerx');

select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select public.record_drawing_open(:'drawd'::uuid);
select public.confirm_drawing_seen(:'drawd'::uuid, now() + interval '6 minutes');

select pg_temp.ok(
  (
    select s.seen_at = s.received_at
    from public.drawing_seen s
    where s.drawing_id = :'drawd'::uuid
      and s.person_id = :'opa'::uuid
  ),
  'a tap more than 5 minutes in the future is stored as the server receive time'
);

select public.record_drawing_open(:'drawe'::uuid);
select public.confirm_drawing_seen(:'drawe'::uuid, now() - interval '10 minutes');

select pg_temp.ok(
  (
    select s.seen_at = s.received_at
      and s.seen_at > now() - interval '1 minute'
    from public.drawing_seen s
    where s.drawing_id = :'drawe'::uuid
      and s.person_id = :'opa'::uuid
  ),
  'a tap before the recorded open is stored as the server receive time'
);

select public.confirm_drawing_seen(:'drawe'::uuid, now() + interval '5 minutes');

select pg_temp.ok(
  (
    select s.seen_at = s.received_at
    from public.drawing_seen s
    where s.drawing_id = :'drawe'::uuid
      and s.person_id = :'opa'::uuid
  ),
  'a later acceptable tap does not replace the fallback time'
);

reset role;

rollback;
