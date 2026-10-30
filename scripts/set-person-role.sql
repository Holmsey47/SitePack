-- Site manager role control. Apply scripts/throwaway-auth.sql and every migration first.
-- The checks roll back. Nothing here is a hosted project.
-- A member is operative. A site manager is cm.

\set ON_ERROR_STOP on

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
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
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

insert into auth.users (id, email)
values
  ('a1111111-1111-4111-8111-111111111111', 'ownerx@firmx.test'),
  ('a1111111-1111-4111-8111-111111111115', 'ownerx2@firmx.test'),
  ('a1111111-1111-4111-8111-111111111112', 'cmx@firmx.test'),
  ('a1111111-1111-4111-8111-111111111113', 'member@firmx.test'),
  ('a2222222-2222-4222-8222-222222222221', 'ownery@firmy.test');

insert into public.companies (id, name)
values
  ('c1111111-1111-4111-8111-111111111111', 'Firm X'),
  ('c2222222-2222-4222-8222-222222222222', 'Firm Y');

insert into public.people (id, auth_user_id, company_id, role, display_name, email)
values
  ('a1111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111', 'owner', 'Owner X', 'ownerx@firmx.test'),
  ('a1111111-1111-4111-8111-111111111115', 'a1111111-1111-4111-8111-111111111115', 'c1111111-1111-4111-8111-111111111111', 'owner', 'Owner X Two', 'ownerx2@firmx.test'),
  ('a1111111-1111-4111-8111-111111111112', 'a1111111-1111-4111-8111-111111111112', 'c1111111-1111-4111-8111-111111111111', 'cm', 'CM X', 'cmx@firmx.test'),
  ('a1111111-1111-4111-8111-111111111113', 'a1111111-1111-4111-8111-111111111113', 'c1111111-1111-4111-8111-111111111111', 'operative', 'Member X', 'member@firmx.test'),
  ('a2222222-2222-4222-8222-222222222221', 'a2222222-2222-4222-8222-222222222221', 'c2222222-2222-4222-8222-222222222222', 'owner', 'Owner Y', 'ownery@firmy.test');

insert into public.sites (id, company_id, name)
values
  ('51111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111', 'Yard X');

insert into public.site_assignments (site_id, person_id)
values
  ('51111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111112'),
  ('51111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111113');

select pg_temp.ok(
  not has_function_privilege('anon', 'public.set_person_role(uuid, text)', 'execute')
  and not has_function_privilege('public', 'public.set_person_role(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.set_person_role(uuid, text)', 'execute'),
  'set_person_role is granted to authenticated and revoked from public and anon'
);

select pg_temp.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) cfg
    where n.nspname = 'public'
      and p.proname = 'set_person_role'
      and p.prosecdef
      and cfg = 'search_path=""'
  ),
  'set_person_role is security definer with an empty search_path'
);

select pg_temp.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_person_role'
      and position('auth.uid()' in p.prosrc) > 0
      and position('public.people' in p.prosrc) > 0
      and position('public.person_role_audit' in p.prosrc) > 0
  ),
  'set_person_role schema-qualifies auth, people, and the audit table'
);

select pg_temp.ok(
  has_table_privilege('authenticated', 'public.person_role_audit', 'select')
  and not has_table_privilege('authenticated', 'public.person_role_audit', 'insert')
  and not has_table_privilege('anon', 'public.person_role_audit', 'select')
  and not has_table_privilege('public', 'public.person_role_audit', 'select'),
  'the audit table is select-only for authenticated'
);

-- Signed out.
reset role;
set local role anon;

select pg_temp.ok(
  pg_temp.raises(
    'select public.set_person_role(''a1111111-1111-4111-8111-111111111113'', ''cm'')',
    'permission denied for function set_person_role'
  ),
  'a signed-out call is refused'
);

-- Signed in with no person.
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.set_person_role(''a1111111-1111-4111-8111-111111111113'', ''cm'')',
    'not_authorized'
  ),
  'a session with no person is refused'
);

-- Contracts manager.
reset role;
select pg_temp.jwt('a1111111-1111-4111-8111-111111111112');
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.set_person_role(''a1111111-1111-4111-8111-111111111113'', ''cm'')',
    'not_authorized'
  ),
  'a contracts manager calling the RPC is refused'
);

select pg_temp.ok(
  (select role from public.people where id = 'a1111111-1111-4111-8111-111111111113') = 'operative',
  'a refused contracts manager call leaves the member as operative'
);

-- Member.
reset role;
select pg_temp.jwt('a1111111-1111-4111-8111-111111111113');
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.set_person_role(''a1111111-1111-4111-8111-111111111112'', ''operative'')',
    'not_authorized'
  ),
  'a member calling the RPC is refused'
);

select pg_temp.ok(
  pg_temp.raises(
    $$select public.replace_drawing(
      '51111111-1111-4111-8111-111111111111',
      'Role check',
      'A',
      'c1111111-1111-4111-8111-111111111111/51111111-1111-4111-8111-111111111111/role-check.pdf',
      'RC',
      null,
      1200,
      'application/pdf',
      null,
      'd4111111-1111-4111-8111-111111111111',
      'Other',
      null
    )$$,
    'not_authorized'
  ),
  'a member cannot upload before they are a site manager'
);

select pg_temp.ok(
  pg_temp.raises(
    $$insert into storage.objects (bucket_id, name)
      values (
        'drawings',
        'c1111111-1111-4111-8111-111111111111/51111111-1111-4111-8111-111111111111/role-check.pdf'
      )$$,
    'new row violates row-level security policy for table "objects"'
  ),
  'a member cannot store a drawing file before they are a site manager'
);

-- Another company's owner.
reset role;
select pg_temp.jwt('a2222222-2222-4222-8222-222222222221');
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.set_person_role(''a1111111-1111-4111-8111-111111111113'', ''cm'')',
    'not_authorized'
  ),
  'another company owner is refused'
);

select pg_temp.ok(
  (select count(*) from public.person_role_audit) = 0,
  'another company owner sees no audit rows'
);

-- This company's owner. Self, the other owner, and bad roles.
reset role;
select pg_temp.jwt('a1111111-1111-4111-8111-111111111111');
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.set_person_role(''a1111111-1111-4111-8111-111111111111'', ''operative'')',
    'not_authorized'
  ),
  'an owner cannot demote themselves'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.set_person_role(''a1111111-1111-4111-8111-111111111115'', ''operative'')',
    'not_authorized'
  ),
  'an owner cannot demote another owner'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.set_person_role(''a1111111-1111-4111-8111-111111111113'', ''owner'')',
    'not_authorized'
  )
  and pg_temp.raises(
    'select public.set_person_role(''a1111111-1111-4111-8111-111111111113'', ''member'')',
    'not_authorized'
  )
  and pg_temp.raises(
    'select public.set_person_role(''a1111111-1111-4111-8111-111111111113'', '' cm'')',
    'not_authorized'
  )
  and pg_temp.raises(
    'select public.set_person_role(''a1111111-1111-4111-8111-111111111113'', null)',
    'not_authorized'
  ),
  'only the operative and cm role names are accepted'
);

select pg_temp.ok(
  pg_temp.raises(
    'update public.people set role = ''cm'' where id = ''a1111111-1111-4111-8111-111111111113''',
    'not_authorized'
  ),
  'an owner cannot change a role by updating the people row'
);

select pg_temp.ok(
  (select role from public.people where id = 'a1111111-1111-4111-8111-111111111111') = 'owner'
  and (select role from public.people where id = 'a1111111-1111-4111-8111-111111111115') = 'owner'
  and (select role from public.people where id = 'a1111111-1111-4111-8111-111111111113') = 'operative'
  and (select count(*) from public.person_role_audit) = 0,
  'refused calls write no audit row and leave every role unchanged'
);

-- Promote. The same login then uploads. No new session.
select public.set_person_role('a1111111-1111-4111-8111-111111111113', 'cm');

select pg_temp.ok(
  (select role from public.people where id = 'a1111111-1111-4111-8111-111111111113') = 'cm'
  and (select count(*) from public.person_role_audit) = 1
  and (
    select actor_id = 'a1111111-1111-4111-8111-111111111111'
      and person_id = 'a1111111-1111-4111-8111-111111111113'
      and old_role = 'operative'
      and new_role = 'cm'
      and created_at is not null
    from public.person_role_audit
  ),
  'promoting a member writes one audit row'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.set_person_role(''a1111111-1111-4111-8111-111111111113'', ''cm'')',
    'not_authorized'
  )
  and (select count(*) from public.person_role_audit) = 1,
  'setting the same role again is refused and writes no second row'
);

reset role;
select pg_temp.jwt('a1111111-1111-4111-8111-111111111113');
set local role authenticated;

select public.replace_drawing(
  '51111111-1111-4111-8111-111111111111',
  'Role check',
  'A',
  'c1111111-1111-4111-8111-111111111111/51111111-1111-4111-8111-111111111111/role-check.pdf',
  'RC',
  null,
  1200,
  'application/pdf',
  null,
  'd4111111-1111-4111-8111-111111111111',
  'Other',
  null
);

insert into storage.objects (bucket_id, name)
values (
  'drawings',
  'c1111111-1111-4111-8111-111111111111/51111111-1111-4111-8111-111111111111/role-check.pdf'
);

select pg_temp.ok(
  (
    select uploaded_by = 'a1111111-1111-4111-8111-111111111113' and is_current
    from public.drawings
    where id = 'd4111111-1111-4111-8111-111111111111'
  )
  and exists (
    select 1
    from storage.objects
    where bucket_id = 'drawings'
      and name = 'c1111111-1111-4111-8111-111111111111/51111111-1111-4111-8111-111111111111/role-check.pdf'
  ),
  'the promoted member can upload a drawing on their site'
);

-- Demote. The same login can no longer upload.
reset role;
select pg_temp.jwt('a1111111-1111-4111-8111-111111111111');
set local role authenticated;

select public.set_person_role('a1111111-1111-4111-8111-111111111113', 'operative');

select pg_temp.ok(
  (select role from public.people where id = 'a1111111-1111-4111-8111-111111111113') = 'operative'
  and (select count(*) from public.person_role_audit) = 2
  and exists (
    select 1
    from public.person_role_audit
    where actor_id = 'a1111111-1111-4111-8111-111111111111'
      and person_id = 'a1111111-1111-4111-8111-111111111113'
      and old_role = 'cm'
      and new_role = 'operative'
      and created_at is not null
  ),
  'demoting a site manager writes a second audit row'
);

reset role;
select pg_temp.jwt('a1111111-1111-4111-8111-111111111113');
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    $$select public.replace_drawing(
      '51111111-1111-4111-8111-111111111111',
      'Role check gone',
      'A',
      'c1111111-1111-4111-8111-111111111111/51111111-1111-4111-8111-111111111111/role-gone.pdf',
      'RG',
      null,
      1200,
      'application/pdf',
      null,
      'd4111111-1111-4111-8111-111111111112',
      'Other',
      null
    )$$,
    'not_authorized'
  ),
  'after demotion the member cannot upload'
);

select pg_temp.ok(
  pg_temp.raises(
    $$insert into public.drawings (site_id, title, revision, is_current, storage_path, uploaded_by)
      values (
        '51111111-1111-4111-8111-111111111111',
        'Direct insert',
        'A',
        true,
        'c1111111-1111-4111-8111-111111111111/51111111-1111-4111-8111-111111111111/direct.pdf',
        'a1111111-1111-4111-8111-111111111113'
      )$$,
    'new row violates row-level security policy for table "drawings"'
  ),
  'after demotion a drawing insert is refused'
);

select pg_temp.ok(
  pg_temp.raises(
    $$insert into storage.objects (bucket_id, name)
      values (
        'drawings',
        'c1111111-1111-4111-8111-111111111111/51111111-1111-4111-8111-111111111111/role-gone.pdf'
      )$$,
    'new row violates row-level security policy for table "objects"'
  ),
  'after demotion a drawing file is refused'
);

select pg_temp.ok(
  (select count(*) from public.drawings where title = 'Role check gone') = 0
  and (select count(*) from public.drawings where title = 'Direct insert') = 0,
  'refused uploads leave no drawing row'
);

-- Who can read the audit.
reset role;
select pg_temp.jwt('a1111111-1111-4111-8111-111111111112');
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.person_role_audit) = 0,
  'a contracts manager cannot read the audit'
);

reset role;
select pg_temp.jwt('a1111111-1111-4111-8111-111111111113');
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.person_role_audit) = 0,
  'a member cannot read the audit'
);

reset role;
select pg_temp.jwt('a2222222-2222-4222-8222-222222222221');
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.person_role_audit) = 0,
  'another company owner cannot read the audit'
);

reset role;
select pg_temp.jwt('a1111111-1111-4111-8111-111111111111');
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.person_role_audit) = 2
  and pg_temp.raises(
    $$insert into public.person_role_audit (company_id, actor_id, person_id, old_role, new_role)
      values (
        'c1111111-1111-4111-8111-111111111111',
        'a1111111-1111-4111-8111-111111111111',
        'a1111111-1111-4111-8111-111111111113',
        'operative',
        'cm'
      )$$,
    'permission denied for table person_role_audit'
  ),
  'the owner can read both audit rows and cannot insert one'
);

reset role;
set local role service_role;

select pg_temp.ok(
  pg_temp.raises(
    'update public.people set role = ''cm'' where id = ''a1111111-1111-4111-8111-111111111113''',
    'not_authorized'
  ),
  'service_role cannot change a role outside set_person_role'
);

rollback;
