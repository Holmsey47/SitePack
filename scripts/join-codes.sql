-- Join codes. Apply migrations and seed first, then:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v migration=supabase/migrations/20261021210000_join_codes.sql -f scripts/join-codes.sql
-- The logical checks roll back. A second apply of the migration runs first.
-- The cap race commits four parallel joins, then the throwaway database is discarded.

\set ON_ERROR_STOP on
\ir :migration

alter database sitepack set app.join_code_pepper to 'probe-pepper';
select set_config('app.join_code_pepper', 'probe-pepper', false);

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

create or replace function pg_temp.as_user(p_sub uuid, p_role text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(p_role, ''), true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', coalesce(p_sub::text, ''), 'role', coalesce(p_role, ''))::text,
    true
  );
end;
$$;

select pg_temp.ok(
  encode(extensions.hmac('K7QM4XPR'::text, 'probe-pepper'::text, 'sha256'::text), 'hex')
    = '1710b797362358fd1e6f14ec85f07f2565263eeeb333cc5782717326a847257c',
  'hmac vector matches the pepper'
);

select pg_temp.ok(
  not has_function_privilege('anon', 'public.apply_join_code(text, uuid, text, text, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.apply_join_code(text, uuid, text, text, text, text, text)', 'execute')
  and not has_function_privilege('public', 'public.apply_join_code(text, uuid, text, text, text, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.apply_join_code(text, uuid, text, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.redeem_password_reset(text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.redeem_password_reset(text, text)', 'execute')
  and has_function_privilege('service_role', 'public.redeem_password_reset(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.lookup_username_login(text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.lookup_username_login(text, text)', 'execute')
  and has_function_privilege('service_role', 'public.lookup_username_login(text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.create_join_code(uuid, text, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.create_join_code(uuid, text, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.remove_joiner(uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.reset_password_code(uuid)', 'execute')
  and not has_column_privilege('authenticated', 'public.join_codes', 'code_hash', 'select')
  and not has_column_privilege('anon', 'public.join_codes', 'code_hash', 'select')
  and not has_column_privilege('service_role', 'public.join_codes', 'code_hash', 'select')
  and not has_column_privilege('authenticated', 'public.people', 'email', 'select')
  and not has_column_privilege('authenticated', 'public.people', 'phone', 'select')
  and not has_table_privilege('authenticated', 'public.join_rate_limits', 'select')
  and not has_table_privilege('anon', 'public.password_reset_codes', 'select')
  and not has_function_privilege('anon', 'public.site_contracts_manager_names(uuid)', 'execute')
  and not has_function_privilege('public', 'public.site_contracts_manager_names(uuid)', 'execute'),
  'service RPCs, hidden hash, hidden contact columns, M10 revoke'
);

select pg_temp.ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) cfg
    where n.nspname = 'public'
      and p.proname = 'apply_join_code'
      and cfg like 'search_path=%'
  )
  and exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) cfg
    where n.nspname = 'public'
      and p.proname = 'reset_password_code'
      and cfg like 'search_path=%'
  ),
  'join and reset functions pin search_path'
);

select pg_temp.ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'people_directory'
      and column_name in ('email', 'phone')
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'people_directory'
      and column_name = 'username'
  ),
  'directory has username and no email or phone'
);

begin;

-- The edge function hashes the code. service_role only receives the hex.
-- This grant lets the probe compute that hex while role is service_role.
grant usage on schema extensions to service_role;

create temp table probe_vars (k text primary key, v text);
grant all on table probe_vars to authenticated, service_role;

select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;

insert into probe_vars (k, v)
values (
  'oak',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'Oak fixers',
    3,
    24
  )::text
);

insert into probe_vars (k, v)
values (
  'defaults',
  public.create_join_code('66666666-6666-6666-6666-666666666666')::text
);

insert into probe_vars (k, v)
values (
  'riverside',
  public.create_join_code(
    '77777777-7777-7777-7777-777777777777',
    'Riverside',
    5,
    24
  )::text
);

do $$
begin
  perform public.create_join_code('66666666-6666-6666-6666-666666666666', 'too many', 26, 24);
  raise exception 'FAIL: cap 26 was accepted';
exception
  when others then
    if sqlerrm <> 'cap_out_of_range' then
      raise;
    end if;
    raise notice 'ok: hard max 25';
end $$;

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select (v::jsonb)->>'label' from probe_vars where k = 'oak') = 'Oak fixers'
  and (select ((v::jsonb)->>'max_uses')::int from probe_vars where k = 'oak') = 3
  and (select ((v::jsonb)->>'max_uses')::int from probe_vars where k = 'defaults') = 10
  and (select ((v::jsonb)->>'expires_at')::timestamptz from probe_vars where k = 'defaults')
      between now() + interval '23 hours' and now() + interval '25 hours'
  and (select code_hash from public.join_codes where id = ((select v::jsonb->>'id' from probe_vars where k = 'oak')::uuid))
      = extensions.hmac(
          replace((select v::jsonb->>'code' from probe_vars where k = 'oak'), '-', ''),
          'probe-pepper',
          'sha256'
        )
  and (select v::jsonb->>'code' from probe_vars where k = 'oak')
      ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$'
  and not exists (
    select 1
    from public.join_audit a
    where a.action = 'code_create'
      and a.detail::text like '%' || replace((select v::jsonb->>'code' from probe_vars where k = 'oak'), '-', '') || '%'
  ),
  'created code is scoped, hashed, default 10 uses, plaintext not in the audit'
);

-- seed.sql drops private.seed_auth_user. Insert the auth rows the join needs.
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'a1111111-1111-4111-8111-111111111111@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'a2222222-2222-4222-8222-222222222222@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a3333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'a3333333-3333-4333-8333-333333333333@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a4444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'a4444444-4444-4444-8444-444444444444@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'a5555555-5555-4555-8555-555555555555@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0', 'authenticated', 'authenticated', 'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0@users.sitepack.invalid', now(), now());

insert into public.people (id, auth_user_id, company_id, role, trade, display_name, username)
values (
  'd10d10d1-0d10-4d10-8d10-d10d10d10d10',
  'a5555555-5555-4555-8555-555555555555',
  '11111111-1111-1111-1111-111111111111',
  'operative',
  'fixer',
  'Rio Kent',
  'riokent'
);
insert into public.site_assignments (site_id, person_id)
values (
  '77777777-7777-7777-7777-777777777777',
  'd10d10d1-0d10-4d10-8d10-d10d10d10d10'
);

update public.people
set username = 'bentorres'
where id = '55555555-5555-5555-5555-555555555555';

select pg_temp.as_user(null, 'service_role');
set local role service_role;

insert into probe_vars (k, v)
select
  'join1',
  public.apply_join_code(
    encode(extensions.hmac(replace((select v::jsonb->>'code' from probe_vars where k = 'oak'), '-', ''), 'probe-pepper', 'sha256'), 'hex'),
    'a1111111-1111-4111-8111-111111111111',
    'Sam Reed',
    'fixer',
    'samreed',
    '203.0.113.11',
    'probe'
  )::text;

insert into probe_vars (k, v)
select
  'join2',
  public.apply_join_code(
    encode(extensions.hmac(replace((select v::jsonb->>'code' from probe_vars where k = 'oak'), '-', ''), 'probe-pepper', 'sha256'), 'hex'),
    'a2222222-2222-4222-8222-222222222222',
    'Lee Join',
    'fixer',
    'leejoin',
    '203.0.113.12',
    'probe'
  )::text;

insert into probe_vars (k, v)
select
  'join3',
  public.apply_join_code(
    encode(extensions.hmac(replace((select v::jsonb->>'code' from probe_vars where k = 'oak'), '-', ''), 'probe-pepper', 'sha256'), 'hex'),
    'a3333333-3333-4333-8333-333333333333',
    'Nia Join',
    'fixer',
    'niajoin',
    '203.0.113.13',
    'probe'
  )::text;

insert into probe_vars (k, v)
select
  'join4',
  public.apply_join_code(
    encode(extensions.hmac(replace((select v::jsonb->>'code' from probe_vars where k = 'oak'), '-', ''), 'probe-pepper', 'sha256'), 'hex'),
    'a4444444-4444-4444-8444-444444444444',
    'Fourth Lad',
    'fixer',
    'fourthlad',
    '203.0.113.14',
    'probe'
  )::text;

insert into probe_vars (k, v)
select
  'wrong',
  public.apply_join_code(
    encode(extensions.hmac('ZZZZZZZZ', 'probe-pepper', 'sha256'), 'hex'),
    'a4444444-4444-4444-8444-444444444444',
    'Nope',
    'fixer',
    'nopeuser',
    '203.0.113.20',
    'probe'
  )::text;

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select v::jsonb->>'ok' from probe_vars where k = 'join1') = 'true'
  and (select v::jsonb->>'ok' from probe_vars where k = 'join2') = 'true'
  and (select v::jsonb->>'ok' from probe_vars where k = 'join3') = 'true'
  and (select v::jsonb->>'error' from probe_vars where k = 'join4') = 'join_rejected'
  and (select uses from public.join_codes where id = ((select v::jsonb->>'id' from probe_vars where k = 'oak')::uuid)) = 3
  and (select count(*) from public.people where username = 'fourthlad') = 0,
  'fourth join fails on a cap of 3 and uses stays 3'
);

select pg_temp.ok(
  (select company_id from public.people where username = 'samreed')
    = '11111111-1111-1111-1111-111111111111'
  and (select role from public.people where username = 'samreed') = 'operative'
  and (select email from public.people where username = 'samreed') is null
  and (
    select count(*)
    from public.site_assignments a
    join public.people p on p.id = a.person_id
    where p.username = 'samreed'
      and a.site_id = '66666666-6666-6666-6666-666666666666'
  ) = 1
  and (
    select count(*)
    from public.site_assignments a
    join public.people p on p.id = a.person_id
    where p.username = 'samreed'
      and a.site_id <> '66666666-6666-6666-6666-666666666666'
  ) = 0
  and (select v::jsonb->>'site_id' from probe_vars where k = 'join1')
      = '66666666-6666-6666-6666-666666666666'
  and (select v::jsonb->>'company_id' from probe_vars where k = 'join1')
      = '11111111-1111-1111-1111-111111111111',
  'join scopes only to the code company and site as operative'
);

-- Expired and revoked match the wrong-code payload. No site or company name.
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;

insert into probe_vars (k, v)
values (
  'expire_me',
  public.create_join_code('66666666-6666-6666-6666-666666666666', 'expires', 5, 24)::text
);

insert into probe_vars (k, v)
values (
  'revoke_me',
  public.create_join_code('66666666-6666-6666-6666-666666666666', 'revokes', 5, 24)::text
);

select public.revoke_join_code((select (v::jsonb->>'id')::uuid from probe_vars where k = 'revoke_me'));

reset role;
select pg_temp.as_user(null, '');

update public.join_codes
set expires_at = now() - interval '1 minute'
where id = (select (v::jsonb->>'id')::uuid from probe_vars where k = 'expire_me');

select pg_temp.as_user(null, 'service_role');
set local role service_role;

insert into probe_vars (k, v)
select
  'expired',
  public.apply_join_code(
    encode(extensions.hmac(replace((select v::jsonb->>'code' from probe_vars where k = 'expire_me'), '-', ''), 'probe-pepper', 'sha256'), 'hex'),
    'a4444444-4444-4444-8444-444444444444',
    'Nope',
    'fixer',
    'nopeuser',
    '203.0.113.21',
    'probe'
  )::text;

insert into probe_vars (k, v)
select
  'revoked',
  public.apply_join_code(
    encode(extensions.hmac(replace((select v::jsonb->>'code' from probe_vars where k = 'revoke_me'), '-', ''), 'probe-pepper', 'sha256'), 'hex'),
    'a4444444-4444-4444-8444-444444444444',
    'Nope',
    'fixer',
    'nopeuser',
    '203.0.113.22',
    'probe'
  )::text;

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select v::jsonb from probe_vars where k = 'wrong')
    = (select v::jsonb from probe_vars where k = 'expired')
  and (select v::jsonb from probe_vars where k = 'wrong')
    = (select v::jsonb from probe_vars where k = 'revoked')
  and (select v::jsonb from probe_vars where k = 'wrong')
    = (select v::jsonb from probe_vars where k = 'join4')
  and (select v::jsonb->>'error' from probe_vars where k = 'wrong') = 'join_rejected'
  and (select v from probe_vars where k = 'wrong') not like '%Oak%'
  and (select v from probe_vars where k = 'wrong') not like '%Ashfield%'
  and (select v from probe_vars where k = 'wrong') not like '%Riverside%'
  and (select v from probe_vars where k = 'expired') not like '%Oak%'
  and (select v from probe_vars where k = 'revoked') not like '%Oak%',
  'wrong, expired, revoked, and over-cap responses are identical'
);

-- Ten failures on one IP lock that IP. Another IP still joins.
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;
insert into probe_vars (k, v)
values (
  'open',
  public.create_join_code('66666666-6666-6666-6666-666666666666', 'still open', 5, 24)::text
);
reset role;
select pg_temp.as_user(null, 'service_role');
set local role service_role;

insert into probe_vars (k, v)
select 'lock' || g, public.apply_join_code(
  encode(extensions.hmac('YYYYYYYY', 'probe-pepper', 'sha256'), 'hex'),
  'a4444444-4444-4444-8444-444444444444',
  'Nope',
  'fixer',
  'nopeuser',
  '198.51.100.10',
  'probe'
)::text
from generate_series(1, 10) g;

insert into probe_vars (k, v)
select
  'locked_valid',
  public.apply_join_code(
    encode(extensions.hmac(replace((select v::jsonb->>'code' from probe_vars where k = 'open'), '-', ''), 'probe-pepper', 'sha256'), 'hex'),
    'a4444444-4444-4444-8444-444444444444',
    'Still Locked',
    'fixer',
    'lockedlad',
    '198.51.100.10',
    'probe'
  )::text;

insert into probe_vars (k, v)
select
  'other_ip',
  public.apply_join_code(
    encode(extensions.hmac(replace((select v::jsonb->>'code' from probe_vars where k = 'open'), '-', ''), 'probe-pepper', 'sha256'), 'hex'),
    'a4444444-4444-4444-8444-444444444444',
    'Other Net',
    'fixer',
    'othernet',
    '198.51.100.77',
    'probe'
  )::text;

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select count(*) from probe_vars where k like 'lock%' and k <> 'locked_valid' and v::jsonb->>'error' = 'join_rejected') = 10
  and (select v::jsonb->>'error' from probe_vars where k = 'locked_valid') = 'join_rejected'
  and (select v::jsonb from probe_vars where k = 'locked_valid') = (select v::jsonb from probe_vars where k = 'wrong')
  and (select count(*) from public.people where username = 'lockedlad') = 0
  and (select v::jsonb->>'ok' from probe_vars where k = 'other_ip') = 'true'
  and private.join_failure_count('ip', '198.51.100.10', interval '15 minutes') >= 10,
  'ten failures lock that IP and a different IP still joins'
);

-- Joiner sees Oak mates, not Rio, and cannot read email or phone.
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111', 'authenticated');
set local role authenticated;

select pg_temp.ok(
  exists (select 1 from public.people_directory where username = 'bentorres')
  and exists (select 1 from public.people_directory where id = '44444444-4444-4444-4444-444444444444')
  and not exists (select 1 from public.people_directory where username = 'riokent')
  and not exists (select 1 from public.people_directory where id = '22222222-2222-2222-2222-222222222222'),
  'joiner sees people on their site only'
);

do $$
begin
  perform email from public.people;
  raise exception 'FAIL: joiner read email';
exception
  when insufficient_privilege then
    raise notice 'ok: joiner cannot read email';
end $$;

do $$
begin
  perform phone from public.people;
  raise exception 'FAIL: joiner read phone';
exception
  when insufficient_privilege then
    raise notice 'ok: joiner cannot read phone';
end $$;

do $$
begin
  perform code_hash from public.join_codes;
  raise exception 'FAIL: code_hash was selectable';
exception
  when insufficient_privilege then
    raise notice 'ok: code_hash is not selectable';
end $$;

reset role;
select pg_temp.as_user(null, '');

-- CM sees Oak codes and not the Riverside code.
select pg_temp.as_user('33333333-3333-3333-3333-333333333333', 'authenticated');
set local role authenticated;

select pg_temp.ok(
  exists (
    select 1 from public.join_codes
    where id = (select (v::jsonb->>'id')::uuid from probe_vars where k = 'oak')
  )
  and not exists (
    select 1 from public.join_codes
    where id = (select (v::jsonb->>'id')::uuid from probe_vars where k = 'riverside')
  ),
  'CM sees their sites and not a site they are off'
);

do $$
begin
  perform public.reset_password_code('22222222-2222-2222-2222-222222222222');
  raise exception 'FAIL: CM reset the owner';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: CM cannot reset the owner';
end $$;

do $$
begin
  perform public.reset_password_code('d10d10d1-0d10-4d10-8d10-d10d10d10d10');
  raise exception 'FAIL: CM reset a Riverside-only operative';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: CM cannot reset an operative off their sites';
end $$;

reset role;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;

do $$
begin
  perform public.reset_password_code('33333333-3333-3333-3333-333333333333');
  raise exception 'FAIL: owner reset the CM';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: owner cannot reset a CM account';
end $$;

do $$
begin
  perform public.reset_password_code('22222222-2222-2222-2222-222222222222');
  raise exception 'FAIL: owner reset the owner';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: owner cannot reset the owner account';
end $$;

insert into probe_vars (k, v)
values (
  'reset1',
  public.reset_password_code((select id from public.people where username = 'samreed'))::text
);

insert into probe_vars (k, v)
values (
  'reset2',
  public.reset_password_code((select id from public.people where username = 'samreed'))::text
);

reset role;
select pg_temp.as_user(null, '');

insert into auth.sessions (id, user_id)
values ('b1111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111');
insert into auth.refresh_tokens (token, user_id, session_id)
values ('sam-token', 'a1111111-1111-4111-8111-111111111111', 'b1111111-1111-4111-8111-111111111111');

select pg_temp.as_user(null, 'service_role');
set local role service_role;

insert into probe_vars (k, v)
select
  'redeem1',
  public.redeem_password_reset(
    encode(extensions.hmac(replace((select v::jsonb->>'code' from probe_vars where k = 'reset1'), '-', ''), 'probe-pepper', 'sha256'), 'hex'),
    '203.0.113.40'
  )::text;

insert into probe_vars (k, v)
select
  'redeem2',
  public.redeem_password_reset(
    encode(extensions.hmac(replace((select v::jsonb->>'code' from probe_vars where k = 'reset2'), '-', ''), 'probe-pepper', 'sha256'), 'hex'),
    '203.0.113.41'
  )::text;

insert into probe_vars (k, v)
select
  'redeem3',
  public.redeem_password_reset(
    encode(extensions.hmac(replace((select v::jsonb->>'code' from probe_vars where k = 'reset2'), '-', ''), 'probe-pepper', 'sha256'), 'hex'),
    '203.0.113.42'
  )::text;

insert into probe_vars (k, v)
select
  'lookup',
  public.lookup_username_login('bentorres', '203.0.113.50')::text;

insert into probe_vars (k, v)
select
  'lookup_miss',
  public.lookup_username_login('nobodyhere', '203.0.113.51')::text;

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select v::jsonb->>'error' from probe_vars where k = 'redeem1') = 'reset_rejected'
  and (select v::jsonb->>'ok' from probe_vars where k = 'redeem2') = 'true'
  and (select v::jsonb->>'error' from probe_vars where k = 'redeem3') = 'reset_rejected'
  and (select password_reset_at from public.people where username = 'samreed') is not null
  and (select count(*) from auth.sessions where user_id = 'a1111111-1111-4111-8111-111111111111') = 0
  and (select count(*) from auth.refresh_tokens where user_id = 'a1111111-1111-4111-8111-111111111111') = 0
  and exists (
    select 1
    from public.password_reset_codes c
    join public.people p on p.id = c.person_id
    where p.username = 'samreed'
      and c.revoked_at is not null
      and c.used_at is null
  )
  and exists (
    select 1 from public.join_audit
    where action = 'reset_redeem'
      and detail->>'person_id' = (select id::text from public.people where username = 'samreed')
  )
  and (select v::jsonb->>'auth_user_id' from probe_vars where k = 'lookup')
      = '55555555-5555-5555-5555-555555555555'
  and (select v from probe_vars where k = 'lookup') not like '%@%'
  and (select v::jsonb->>'error' from probe_vars where k = 'lookup_miss') = 'sign_in_failed'
  and (select v from probe_vars where k = 'lookup_miss') not like '%@%',
  'new reset invalidates the old one, redeem is single use, lookup hides email'
);

-- The assertion above used reset1's person_id field which is not the reset row id.
-- Confirm the redeemed row is the second code by hash instead. Already checked revoked unused and used sessions.

do $$
begin
  update auth.users
  set email = 'real@example.com'
  where id = 'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0';
  raise exception 'FAIL: placeholder email change was allowed';
exception
  when others then
    if sqlerrm <> 'email_change_blocked' then
      raise;
    end if;
    raise notice 'ok: placeholder email change is blocked';
end $$;

-- Remove cuts the assignment, the login, and the sessions.
insert into auth.sessions (id, user_id)
values ('b2222222-2222-4222-8222-222222222222', 'a2222222-2222-4222-8222-222222222222');
insert into auth.refresh_tokens (token, user_id, session_id)
values ('lee-token', 'a2222222-2222-4222-8222-222222222222', 'b2222222-2222-4222-8222-222222222222');

select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;

select public.remove_joiner(
  (select id from public.people where username = 'leejoin'),
  '66666666-6666-6666-6666-666666666666',
  true
);

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select count(*) from public.people where username = 'leejoin') = 0
  and (
    select count(*)
    from public.site_assignments
    where person_id = ((select v::jsonb->>'person_id' from probe_vars where k = 'join2')::uuid)
  ) = 0
  and (select banned_until from auth.users where id = 'a2222222-2222-4222-8222-222222222222') = 'infinity'
  and (select count(*) from auth.sessions where user_id = 'a2222222-2222-4222-8222-222222222222') = 0
  and (select count(*) from auth.refresh_tokens where user_id = 'a2222222-2222-4222-8222-222222222222') = 0
  and (
    select revoked_at from public.join_codes
    where id = (select (v::jsonb->>'id')::uuid from probe_vars where k = 'oak')
  ) is not null
  and exists (
    select 1 from public.join_events
    where auth_user_id = 'a2222222-2222-4222-8222-222222222222'
      and removed_at is not null
  )
  and exists (
    select 1 from public.join_audit
    where action = 'remove'
      and detail->>'person_id' = (select v::jsonb->>'person_id' from probe_vars where k = 'join2')
  ),
  'remove drops the person, bans the login, clears sessions, and can revoke the code'
);

select pg_temp.as_user('a2222222-2222-4222-8222-222222222222', 'authenticated');
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.sites) = 0
  and (select count(*) from public.people_directory) = 0,
  'removed joiner cannot read sites or people'
);

reset role;
select pg_temp.as_user(null, '');

-- Global burst. Top up to 99, then one more failure raises the warning and writes an alert.
insert into public.join_rate_limits (bucket, subject, kind)
select 'global', 'all', 'failure'
from generate_series(
  1,
  greatest(
    0,
    99 - private.join_failure_count('global', 'all', interval '10 minutes')
  )
);

select pg_temp.as_user(null, 'service_role');
set local role service_role;

insert into probe_vars (k, v)
values (
  'burst',
  public.apply_join_code(
    encode(extensions.hmac('XXXXXXXX', 'probe-pepper', 'sha256'), 'hex'),
    'a4444444-4444-4444-8444-444444444444',
    'Nope',
    'fixer',
    'nopeuser',
    '198.51.100.200',
    'probe'
  )::text
);

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select v::jsonb->>'error' from probe_vars where k = 'burst') = 'join_rejected'
  and private.join_failure_count('global', 'all', interval '10 minutes') >= 100
  and exists (
    select 1 from public.join_rate_limits
    where bucket = 'global' and subject = 'all' and kind = 'alert'
  ),
  'global failure cap records an alert'
);

select pg_temp.ok(
  exists (select 1 from public.join_audit where action = 'code_create')
  and exists (select 1 from public.join_audit where action = 'code_revoke')
  and exists (select 1 from public.join_audit where action = 'join')
  and exists (select 1 from public.join_audit where action = 'remove')
  and exists (select 1 from public.join_audit where action = 'reset_issue')
  and exists (select 1 from public.join_audit where action = 'reset_redeem'),
  'audit covers create, revoke, join, remove, and reset'
);

rollback;

-- ---------------------------------------------------------------------------
-- Concurrent cap. Committed so the other connections can see the code row.
-- ---------------------------------------------------------------------------

create extension if not exists dblink;
select set_config('app.probe_conn', :'probe_conn', false);

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '22222222-2222-2222-2222-222222222222',
    'role', 'authenticated'
  )::text,
  false
);
select set_config('app.join_code_pepper', 'probe-pepper', false);

create temp table probe_race (payload jsonb);
grant all on table probe_race to authenticated;

set role authenticated;
insert into probe_race
select public.create_join_code(
  '66666666-6666-6666-6666-666666666666',
  'race',
  3,
  24
);
reset role;

select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claim.role', '', false);
select set_config('request.jwt.claims', '{}', false);

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'c0de0001-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'c0de0001-0000-4000-8000-000000000001@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0de0002-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'c0de0002-0000-4000-8000-000000000002@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0de0003-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'c0de0003-0000-4000-8000-000000000003@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0de0004-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'c0de0004-0000-4000-8000-000000000004@users.sitepack.invalid', now(), now());

do $$
declare
  v_code text;
  v_hash text;
  i int;
  auth_ids uuid[] := array[
    'c0de0001-0000-4000-8000-000000000001',
    'c0de0002-0000-4000-8000-000000000002',
    'c0de0003-0000-4000-8000-000000000003',
    'c0de0004-0000-4000-8000-000000000004'
  ]::uuid[];
begin
  select replace(payload->>'code', '-', '') into v_code from probe_race limit 1;
  v_hash := encode(extensions.hmac(v_code, 'probe-pepper', 'sha256'), 'hex');
  for i in 1..4 loop
    perform dblink_connect('race' || i, current_setting('app.probe_conn'));
    perform dblink_send_query(
      'race' || i,
      format(
        'select public.apply_join_code(%L, %L::uuid, %L, %L, %L, %L, %L)',
        v_hash,
        auth_ids[i],
        'Racer ' || i,
        'fixer',
        'racer' || i,
        '10.8.0.' || i,
        'race'
      )
    );
  end loop;
end $$;

create temp table probe_race_out (n int, result jsonb);

do $$
declare
  i int;
  rec record;
begin
  for i in 1..4 loop
    for rec in select * from dblink_get_result('race' || i) as t(result jsonb) loop
      insert into probe_race_out values (i, rec.result);
    end loop;
    perform dblink_disconnect('race' || i);
  end loop;
end $$;

select pg_temp.ok(
  (select count(*) from probe_race_out where result->>'ok' = 'true') = 3
  and (select count(*) from probe_race_out where result->>'error' = 'join_rejected') = 1
  and (select uses from public.join_codes where label = 'race') = 3
  and (select count(*) from public.people where username like 'racer%') = 3
  and (
    select count(*)
    from public.site_assignments a
    join public.people p on p.id = a.person_id
    where p.username like 'racer%'
      and a.site_id = '66666666-6666-6666-6666-666666666666'
  ) = 3
  and (
    select count(*)
    from public.site_assignments a
    join public.people p on p.id = a.person_id
    where p.username like 'racer%'
      and a.site_id <> '66666666-6666-6666-6666-666666666666'
  ) = 0
  and (select count(*) from probe_race_out where result::text like '%Oak%' or result::text like '%Ashfield%') = 0,
  'four concurrent joins on a cap of 3 let exactly three through'
);
