-- Home new-count RPC. Apply scripts/throwaway-auth.sql and every migration first.
--   DATABASE_URL=postgres://postgres@127.0.0.1/sitepack_home_counts bash scripts/run-home-new-counts-rls.sh
-- The checks roll back. Nothing here is a hosted project.

\set ON_ERROR_STOP on
\set firmx 'c1111111-1111-4111-8111-111111111111'
\set firmy 'c2222222-2222-4222-8222-222222222222'
\set owner_login 'a1111111-1111-4111-8111-111111111111'
\set owner_person 'b1111111-1111-4111-8111-111111111111'
\set cm_login 'a1111111-1111-4111-8111-111111111112'
\set cm_person 'b1111111-1111-4111-8111-111111111112'
\set lad_login 'a1111111-1111-4111-8111-111111111113'
\set lad_person 'b1111111-1111-4111-8111-111111111113'
\set opb_login 'a1111111-1111-4111-8111-111111111114'
\set opb_person 'b1111111-1111-4111-8111-111111111114'
\set ownery_login 'a2222222-2222-4222-8222-222222222221'
\set ownery_person 'b2222222-2222-4222-8222-222222222221'
\set site1 '51111111-1111-4111-8111-111111111111'
\set site2 '51111111-1111-4111-8111-111111111112'
\set sitey '52222222-2222-4222-8222-222222222221'

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

select pg_temp.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'home_site_new_counts'
      and p.pronargs = 0
      and p.prosecdef = false
      and p.provolatile = 's'
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg = 'search_path=""'
      )
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('public', p.oid, 'execute')
      and has_function_privilege('authenticated', p.oid, 'execute')
  ),
  'home_site_new_counts is invoker, stable, search_path empty, and authenticated only'
);

insert into auth.users (id, email)
values
  (:'owner_login', 'owner@firmx.test'),
  (:'cm_login', 'cm@firmx.test'),
  (:'lad_login', 'lad@firmx.test'),
  (:'opb_login', 'opb@firmx.test'),
  (:'ownery_login', 'owner@firmy.test');

insert into public.companies (id, name)
values
  (:'firmx', 'Firm X'),
  (:'firmy', 'Firm Y');

-- people.id is not the login. The count must use the person id found from auth.uid().
insert into public.people (id, auth_user_id, company_id, role, display_name, email)
values
  (:'owner_person', :'owner_login', :'firmx', 'owner', 'Owner X', 'owner@firmx.test'),
  (:'cm_person', :'cm_login', :'firmx', 'cm', 'CM X', 'cm@firmx.test'),
  (:'lad_person', :'lad_login', :'firmx', 'operative', 'Lad', 'lad@firmx.test'),
  (:'opb_person', :'opb_login', :'firmx', 'operative', 'Op B', 'opb@firmx.test'),
  (:'ownery_person', :'ownery_login', :'firmy', 'owner', 'Owner Y', 'owner@firmy.test');

insert into public.sites (id, company_id, name)
values
  (:'site1', :'firmx', 'Site 1'),
  (:'site2', :'firmx', 'Site 2'),
  (:'sitey', :'firmy', 'Site Y');

insert into public.site_assignments (site_id, person_id)
values
  (:'site1', :'cm_person'),
  (:'site1', :'lad_person'),
  (:'site2', :'opb_person');

insert into public.snags (
  id, site_id, company_id, snag_seq, note, trade_label, raised_by, raised_by_name, raised_at, status
)
values
  (
    'e1111111-1111-4111-8111-111111111111', :'site1', :'firmx', 1,
    'Old snag', 'dryliner', :'cm_person', 'CM X', now() - interval '2 days', 'Open'
  ),
  (
    'e1111111-1111-4111-8111-111111111112', :'site1', :'firmx', 2,
    'New snag', 'dryliner', :'cm_person', 'CM X', now() + interval '1 hour', 'Open'
  ),
  (
    'e1111111-1111-4111-8111-111111111113', :'site1', :'firmx', 3,
    'Lad snag', 'dryliner', :'lad_person', 'Lad', now() + interval '1 hour', 'Open'
  ),
  (
    'e1111111-1111-4111-8111-111111111114', :'site2', :'firmx', 1,
    'Other site', 'labourer', :'opb_person', 'Op B', now() - interval '1 day', 'Open'
  );

insert into public.variations (id, site_id, company_id, vo_seq, created_by)
values
  ('f1111111-1111-4111-8111-111111111111', :'site1', :'firmx', 1, :'cm_person'),
  ('f1111111-1111-4111-8111-111111111112', :'site1', :'firmx', 2, :'lad_person');

insert into public.variation_versions (
  id, variation_id, site_id, version_no, title, description, status, is_current, created_by, created_at
)
values
  (
    'f1111111-1111-4111-8111-111111111121',
    'f1111111-1111-4111-8111-111111111111',
    :'site1', 1, 'Old version', '', 'Draft', false, :'cm_person', now() + interval '2 hours'
  ),
  (
    'f1111111-1111-4111-8111-111111111122',
    'f1111111-1111-4111-8111-111111111111',
    :'site1', 2, 'Current version', '', 'Draft', true, :'cm_person', now() + interval '1 hour'
  ),
  (
    'f1111111-1111-4111-8111-111111111123',
    'f1111111-1111-4111-8111-111111111112',
    :'site1', 1, 'Lad version', '', 'Draft', true, :'lad_person', now() + interval '1 hour'
  );

insert into public.drawing_requests (id, site_id, requester_id, body, status)
values
  ('d1111111-1111-4111-8111-111111111111', :'site1', :'cm_person', 'CM request', 'Open'),
  ('d1111111-1111-4111-8111-111111111112', :'site1', :'lad_person', 'Lad request', 'Open'),
  ('d1111111-1111-4111-8111-111111111113', :'site2', :'opb_person', 'Site 2 request', 'Open');

select pg_temp.jwt(:'lad_login'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.home_site_new_counts() where site_id = :'site2'::uuid) = 0
  and (select count(*) from public.home_site_new_counts() where site_id = :'sitey'::uuid) = 0
  and (select count(*) from public.home_site_new_counts()) = 1
  and (select site_id from public.home_site_new_counts()) = :'site1'::uuid,
  'a lad not assigned to site 2 gets no row'
);

select pg_temp.ok(
  (select snags_new from public.home_site_new_counts() where site_id = :'site1'::uuid) = 2
  and (select variations_new from public.home_site_new_counts() where site_id = :'site1'::uuid) = 1
  and (select requests_new from public.home_site_new_counts() where site_id = :'site1'::uuid) = 0,
  'a lad counts other people''s visible snags and the current variation, not their own rows or a request they cannot see'
);

reset role;
select pg_temp.jwt(:'cm_login'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.home_site_new_counts() where site_id = :'site2'::uuid) = 0
  and (select snags_new from public.home_site_new_counts() where site_id = :'site1'::uuid) = 1
  and (select variations_new from public.home_site_new_counts() where site_id = :'site1'::uuid) = 1
  and (select requests_new from public.home_site_new_counts() where site_id = :'site1'::uuid) = 1,
  'a contracts manager counts the lad''s request and not their own snag'
);

reset role;
select pg_temp.jwt(:'owner_login'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.home_site_new_counts() where site_id = :'site2'::uuid) = 1
  and (select snags_new from public.home_site_new_counts() where site_id = :'site2'::uuid) = 1
  and (select count(*) from public.home_site_new_counts() where site_id = :'sitey'::uuid) = 0,
  'an owner sees site 2 and not another company'
);

reset role;

insert into public.site_list_seen (user_id, site_id, kind)
values (:'lad_login', :'site1', 'snags');

select pg_temp.jwt(:'lad_login'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select snags_new from public.home_site_new_counts() where site_id = :'site1'::uuid) = 1
  and (select variations_new from public.home_site_new_counts() where site_id = :'site1'::uuid) = 1,
  'opening snags drops rows at or before seen_at and leaves variations alone'
);

reset role;
set local role anon;

select pg_temp.ok(
  pg_temp.raises(
    'select * from public.home_site_new_counts()',
    'permission denied for function home_site_new_counts'
  ),
  'anon cannot call home_site_new_counts'
);

reset role;

rollback;
