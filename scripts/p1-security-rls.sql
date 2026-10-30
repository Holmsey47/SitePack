-- P1 security: signed-out RPC, pinned search_path, archived-site co-workers.
-- Apply scripts/throwaway-auth.sql and every migration first.
-- The checks roll back. Nothing here is a hosted project.

\set ON_ERROR_STOP on
\set company 'c1111111-1111-4111-8111-111111111111'
\set owner 'a1111111-1111-4111-8111-111111111111'
\set cm 'a1111111-1111-4111-8111-111111111112'
\set sam 'a1111111-1111-4111-8111-111111111113'
\set amy 'a1111111-1111-4111-8111-111111111114'
\set lee 'a1111111-1111-4111-8111-111111111115'
\set active '51111111-1111-4111-8111-111111111111'
\set finished '51111111-1111-4111-8111-111111111112'

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

-- ---------------------------------------------------------------------------
-- 3b. The five advisor functions. search_path is empty, bodies are qualified.
-- The lint is the same predicate as Supabase 0011_function_search_path_mutable.
-- ---------------------------------------------------------------------------

select pg_temp.ok(
  (
    select count(*) = 5
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in (
        'try_uuid',
        'touch_updated_at',
        'storage_site_id',
        'storage_company_id',
        'guard_site_archive'
      )
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        where cfg = 'search_path=""'
      )
  ),
  'the five advisor functions have search_path pinned to empty'
);

select pg_temp.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on p.pronamespace = n.oid
    left join pg_catalog.pg_depend dep
      on p.oid = dep.objid
     and dep.deptype = 'e'
     and dep.classid = 'pg_catalog.pg_proc'::regclass
    where n.nspname not in (
      '_timescaledb_cache', '_timescaledb_catalog', '_timescaledb_config', '_timescaledb_internal',
      'auth', 'cron', 'extensions', 'graphql', 'graphql_public', 'information_schema', 'net', 'pgmq',
      'pgroonga', 'pgsodium', 'pgsodium_masks', 'pgtle', 'pgbouncer', 'pg_catalog', 'realtime',
      'repack', 'storage', 'supabase_functions', 'supabase_migrations', 'tiger', 'topology', 'vault'
    )
      and dep.objid is null
      and p.proname in (
        'try_uuid',
        'touch_updated_at',
        'storage_site_id',
        'storage_company_id',
        'guard_site_archive'
      )
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        where cfg like 'search_path=%'
      )
  ),
  'the security advisor has 0 mutable search_path warnings for those functions'
);

select pg_temp.ok(
  position('pg_catalog.length(pg_catalog.btrim' in pg_get_functiondef('private.try_uuid(text)'::regprocedure)) > 0
  and position('::pg_catalog.uuid' in pg_get_functiondef('private.try_uuid(text)'::regprocedure)) > 0
  and position('pg_catalog.now()' in pg_get_functiondef('private.touch_updated_at()'::regprocedure)) > 0
  and position('storage.foldername' in pg_get_functiondef('private.storage_site_id(text)'::regprocedure)) > 0
  and position('private.try_uuid' in pg_get_functiondef('private.storage_site_id(text)'::regprocedure)) > 0
  and position('storage.foldername' in pg_get_functiondef('private.storage_company_id(text)'::regprocedure)) > 0
  and position('private.try_uuid' in pg_get_functiondef('private.storage_company_id(text)'::regprocedure)) > 0
  and position('private.my_role()' in pg_get_functiondef('private.guard_site_archive()'::regprocedure)) > 0,
  'the five function bodies are schema-qualified'
);

-- ---------------------------------------------------------------------------
-- 3a. Grants, then a signed-out call.
-- ---------------------------------------------------------------------------

select pg_temp.ok(
  not has_function_privilege('anon', 'public.site_contracts_manager_names(uuid)', 'execute')
  and not has_function_privilege('public', 'public.site_contracts_manager_names(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.site_contracts_manager_names(uuid)', 'execute'),
  'site_contracts_manager_names is authenticated-only'
);

select pg_temp.ok(
  position('(select auth.uid()) is null' in pg_get_functiondef('public.site_contracts_manager_names(uuid)'::regprocedure)) > 0
  and position('private.can_access_site(p_site_id)' in pg_get_functiondef('public.site_contracts_manager_names(uuid)'::regprocedure)) > 0
  and position('s.archived_at is null' in pg_get_functiondef('private.shares_assigned_site(uuid)'::regprocedure)) > 0,
  'the contracts RPC requires auth.uid and site access, and archived sites are ignored'
);

insert into auth.users (id, email)
values
  (:'owner', 'owner@p1.test'),
  (:'cm', 'cm@p1.test'),
  (:'sam', 'sam@p1.test'),
  (:'amy', 'amy@p1.test'),
  (:'lee', 'lee@p1.test');

insert into public.companies (id, name)
values (:'company', 'P1 Finishes');

insert into public.people (id, auth_user_id, company_id, role, display_name, email)
values
  (:'owner', :'owner', :'company', 'owner', 'Jordan Hale', 'owner@p1.test'),
  (:'cm', :'cm', :'company', 'cm', 'Priya Shah', 'cm@p1.test'),
  (:'sam', :'sam', :'company', 'operative', 'Sam Cole', 'sam@p1.test'),
  (:'amy', :'amy', :'company', 'operative', 'Amy Keane', 'amy@p1.test'),
  (:'lee', :'lee', :'company', 'operative', 'Lee Ward', 'lee@p1.test');

insert into public.sites (id, company_id, name)
values
  (:'active', :'company', 'Oak'),
  (:'finished', :'company', 'Old yard');

insert into public.site_assignments (site_id, person_id)
values
  (:'active', :'cm'),
  (:'active', :'sam'),
  (:'active', :'amy'),
  (:'finished', :'amy'),
  (:'finished', :'lee');

set local role anon;

do $$
begin
  perform public.site_contracts_manager_names('51111111-1111-4111-8111-111111111111');
  raise exception 'FAIL: anon executed site_contracts_manager_names';
exception
  when insufficient_privilege then
    raise notice 'ok: a signed-out RPC call is refused';
end $$;

reset role;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.site_contracts_manager_names(''51111111-1111-4111-8111-111111111111''::uuid)',
    'not_authorized'
  ),
  'a session with no auth.uid is refused inside the function'
);

reset role;

-- Lee shares Old yard with Amy. Before the archive he can see her.
select pg_temp.jwt(:'lee'::uuid);
set local role authenticated;

select pg_temp.ok(
  (
    select coalesce(array_agg(id order by id), '{}')
    from public.people_directory
  ) = array[:'amy', :'lee']::uuid[],
  'before the archive, the lad on that site sees his co-worker'
);

reset role;

select pg_temp.jwt(:'owner'::uuid);
set local role authenticated;
select public.archive_site(:'finished'::uuid);
reset role;

select pg_temp.jwt(:'lee'::uuid);
set local role authenticated;

select pg_temp.ok(
  (
    select coalesce(array_agg(id order by id), '{}')
    from public.people_directory
  ) = array[:'lee']::uuid[],
  'a lad on an archived site sees 0 co-workers'
);

reset role;

select pg_temp.jwt(:'sam'::uuid);
set local role authenticated;

select pg_temp.ok(
  (
    select coalesce(array_agg(id order by id), '{}')
    from public.people_directory
  ) = array[:'cm', :'sam', :'amy']::uuid[],
  'a lad on an active site still sees those co-workers and not the archived site'
);

select pg_temp.ok(
  public.site_contracts_manager_names(:'active'::uuid) = '["Priya Shah"]'::jsonb,
  'a lad on the active site can read its contracts manager'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.site_contracts_manager_names(''' || :'finished' || '''::uuid)',
    'not_authorized'
  ),
  'a lad cannot read contracts managers on a site he cannot open'
);

select pg_temp.ok(
  private.try_uuid('not-a-uuid') is null
  and private.try_uuid('  ') is null
  and private.try_uuid('51111111-1111-4111-8111-111111111111')
    = '51111111-1111-4111-8111-111111111111'::uuid
  and private.storage_company_id(:'company' || '/' || :'active' || '/file.pdf')
    = :'company'::uuid
  and private.storage_site_id(:'company' || '/' || :'active' || '/file.pdf')
    = :'active'::uuid,
  'schema-qualified helpers still parse a blank, a bad uuid, and a drawings path'
);

reset role;

select pg_temp.jwt(:'amy'::uuid);
set local role authenticated;

select pg_temp.ok(
  (
    select coalesce(array_agg(id order by id), '{}')
    from public.people_directory
  ) = array[:'cm', :'sam', :'amy']::uuid[],
  'a lad who also sits on the archived site still sees the active site crew'
);

reset role;

select pg_temp.jwt(:'owner'::uuid);
set local role authenticated;

select pg_temp.ok(
  (
    select coalesce(array_agg(id order by id), '{}')
    from public.people_directory
  ) = array[:'owner', :'cm', :'sam', :'amy', :'lee']::uuid[],
  'the owner still sees people on the archived site'
);

update public.sites
set name = 'Oak renamed'
where id = :'active'::uuid;

select pg_temp.ok(
  (select updated_at > now() - interval '1 minute' from public.sites where id = :'active'::uuid)
  and (select name = 'Oak renamed' from public.sites where id = :'active'::uuid),
  'touch_updated_at still runs for the owner'
);

reset role;

select pg_temp.jwt(:'cm'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'update public.sites set archived_at = now() where id = ''' || :'active' || '''::uuid',
    'not_authorized'
  ),
  'guard_site_archive still blocks a contracts manager'
);

reset role;

-- Second apply must not undo the grants or the archived-site rule.
\ir ../supabase/migrations/20261030143000_p1_security_before_logins.sql

select pg_temp.ok(
  not has_function_privilege('anon', 'public.site_contracts_manager_names(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.site_contracts_manager_names(uuid)', 'execute'),
  'the migration applies a second time and the signed-out grant stays revoked'
);

select pg_temp.jwt(:'lee'::uuid);
set local role authenticated;

select pg_temp.ok(
  (
    select coalesce(array_agg(id order by id), '{}')
    from public.people_directory
  ) = array[:'lee']::uuid[],
  'after a second apply, the archived-site lad still sees 0 co-workers'
);

reset role;

rollback;
