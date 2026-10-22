-- Join codes. Apply migrations and seed first, then:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v migration=supabase/migrations/20261021210000_join_codes.sql -f scripts/join-codes.sql
-- The logical checks roll back. A second apply of the migration runs first.
-- The cap race commits four parallel joins, then the throwaway database is discarded.
-- The probe hashes with pgcrypto. The migration does not.

\set ON_ERROR_STOP on
\ir :migration

do $$ begin raise notice 'ok: migration re-applied'; end $$;

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
    case
      when coalesce(p_role, '') = '' and p_sub is null then ''
      else json_build_object('sub', coalesce(p_sub::text, ''), 'role', coalesce(p_role, ''))::text
    end,
    true
  );
end;
$$;

create or replace function pg_temp.mint()
returns text
language plpgsql
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  out text := '';
  raw bytea;
begin
  while char_length(out) < 8 loop
    raw := extensions.gen_random_bytes(1);
    if get_byte(raw, 0) < 248 then
      out := out || substr(alphabet, (get_byte(raw, 0) % 31) + 1, 1);
    end if;
  end loop;
  return out;
end;
$$;

create or replace function pg_temp.code_hash(p_code text)
returns text
language sql
as $$
  select encode(extensions.hmac(replace(p_code, '-', ''), 'probe-pepper', 'sha256'), 'hex');
$$;

select pg_temp.ok(
  pg_temp.code_hash('K7QM4XPR') = '1710b797362358fd1e6f14ec85f07f2565263eeeb333cc5782717326a847257c',
  'hmac vector matches the probe pepper'
);

select pg_temp.ok(
  private.ip_subject('2001:db8:1:2::1') = private.ip_subject('2001:0db8:0001:0002::99')
  and private.ip_subject('2001:db8:1:2::1') = '2001:0db8:0001:0002'
  and private.ip_subject('2001:db8:1:2::1') <> private.ip_subject('2001:db8:1:3::1')
  and private.ip_subject('203.0.113.9') = '203.0.113.9'
  and private.ip_subject('::ffff:203.0.113.9') = '203.0.113.9'
  and private.ip_subject('0:0:0:0:0:ffff:198.51.100.8') = '198.51.100.8'
  and private.ip_subject('::ffff:999.1.1.1') = 'unknown'
  and private.ip_subject('not-an-ip') = 'unknown',
  'ipv6 /64 and ipv4-mapped addresses'
);

select pg_temp.ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ilike '%join_code_pepper%'
  ),
  'no pepper in sql functions'
);

select pg_temp.ok(
  not has_function_privilege('anon', 'public.apply_join_code(text, uuid, text, text, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.apply_join_code(text, uuid, text, text, text, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.apply_join_code(text, uuid, text, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.preview_join_code(text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.preview_join_code(text, text)', 'execute')
  and has_function_privilege('service_role', 'public.preview_join_code(text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.username_is_taken(text, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.username_is_taken(text, text, text)', 'execute')
  and not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'username_is_taken'
      and pg_get_function_identity_arguments(p.oid) = 'text'
  )
  and has_function_privilege('authenticated', 'public.create_join_code(uuid, text, integer, integer, text)', 'execute')
  and not has_function_privilege('anon', 'public.create_join_code(uuid, text, integer, integer, text)', 'execute')
  and not has_function_privilege('anon', 'public.reset_password_code(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.note_login_failure(text, text)', 'execute')
  and has_function_privilege('service_role', 'public.note_login_failure(text, text)', 'execute')
  and not has_column_privilege('authenticated', 'public.join_codes', 'code_hash', 'select')
  and not has_column_privilege('authenticated', 'public.people', 'email', 'select')
  and not has_column_privilege('authenticated', 'public.people', 'phone', 'select')
  and not has_column_privilege('authenticated', 'public.people', 'username', 'select')
  and not has_table_privilege('authenticated', 'public.join_rate_limits', 'select')
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'people_directory' and column_name = 'username'
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'people_directory' and column_name in ('email', 'phone')
  ),
  'service RPCs, hidden hash, hidden username, directory has no contact columns'
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
      and p.proname = 'company_people'
      and cfg like 'search_path=%'
  ),
  'join and company_people pin search_path'
);

begin;

grant usage on schema extensions to authenticated, service_role;

create temp table probe_vars (k text primary key, v text);
grant all on table probe_vars to authenticated, service_role;

insert into probe_vars (k, v) values
  ('oak_plain', pg_temp.mint()),
  ('open_plain', pg_temp.mint()),
  ('expire_plain', pg_temp.mint()),
  ('revoke_plain', pg_temp.mint()),
  ('river_plain', pg_temp.mint()),
  ('cm_plain', pg_temp.mint()),
  ('arch_plain', pg_temp.mint()),
  ('after_global_plain', pg_temp.mint()),
  ('after_ip_plain', pg_temp.mint()),
  ('v6_plain', pg_temp.mint());

update probe_vars set v = pg_temp.code_hash(
  (select plain.v from probe_vars plain where plain.k = replace(probe_vars.k, '_hash', '_plain'))
) where false;

insert into probe_vars (k, v)
select replace(k, '_plain', '_hash'), pg_temp.code_hash(v)
from probe_vars
where k like '%\_plain' escape '\';

select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;

insert into probe_vars (k, v)
values (
  'oak',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'Oak fixers',
    3,
    24,
    (select v from probe_vars where k = 'oak_hash')
  )::text
);

insert into probe_vars (k, v)
values (
  'defaults',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    p_code_hash => (select pg_temp.code_hash(pg_temp.mint()))
  )::text
);

insert into probe_vars (k, v)
values (
  'riverside',
  public.create_join_code(
    '77777777-7777-7777-7777-777777777777',
    'Riverside',
    5,
    24,
    (select v from probe_vars where k = 'river_hash')
  )::text
);

insert into probe_vars (k, v)
values (
  'open',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'still open',
    5,
    24,
    (select v from probe_vars where k = 'open_hash')
  )::text
);

insert into probe_vars (k, v)
values (
  'expire_me',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'expires',
    5,
    24,
    (select v from probe_vars where k = 'expire_hash')
  )::text
);

insert into probe_vars (k, v)
values (
  'revoke_me',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'revokes',
    5,
    24,
    (select v from probe_vars where k = 'revoke_hash')
  )::text
);

do $$
begin
  perform public.create_join_code('66666666-6666-6666-6666-666666666666', 'too many', 26, 24, null);
  raise exception 'FAIL: cap 26 was accepted';
exception
  when others then
    if sqlerrm <> 'cap_out_of_range' then
      raise;
    end if;
    raise notice 'ok: hard max 25';
end $$;

select public.revoke_join_code((select (v::jsonb->>'id')::uuid from probe_vars where k = 'revoke_me'));

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select (v::jsonb)->>'label' from probe_vars where k = 'oak') = 'Oak fixers'
  and (select (v::jsonb) ? 'code' from probe_vars where k = 'oak') = false
  and (select ((v::jsonb)->>'max_uses')::int from probe_vars where k = 'oak') = 3
  and (select ((v::jsonb)->>'max_uses')::int from probe_vars where k = 'defaults') = 10
  and (select code_hash from public.join_codes where id = ((select v::jsonb->>'id' from probe_vars where k = 'oak')::uuid))
      = decode((select v from probe_vars where k = 'oak_hash'), 'hex')
  and not exists (
    select 1 from public.join_audit a
    where a.action = 'code_create'
      and a.detail::text like '%' || (select v from probe_vars where k = 'oak_plain') || '%'
  ),
  'created code stores the hash and does not return plaintext'
);

update public.join_codes
set expires_at = now() - interval '1 minute'
where id = (select (v::jsonb->>'id')::uuid from probe_vars where k = 'expire_me');

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'a1111111-1111-4111-8111-111111111111@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'a2222222-2222-4222-8222-222222222222@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a3333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'a3333333-3333-4333-8333-333333333333@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a4444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'a4444444-4444-4444-8444-444444444444@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'a5555555-5555-4555-8555-555555555555@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'c1111111-1111-4111-8111-111111111111@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'e1111111-1111-4111-8111-111111111111@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'e2222222-2222-4222-8222-222222222222@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'e3333333-3333-4333-8333-333333333333@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'd1111111-1111-4111-8111-111111111111@users.sitepack.invalid', now(), now());

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
values ('77777777-7777-7777-7777-777777777777', 'd10d10d1-0d10-4d10-8d10-d10d10d10d10');

update public.people set username = 'bentorres' where id = '55555555-5555-5555-5555-555555555555';

select pg_temp.as_user(null, 'service_role');
set local role service_role;

insert into probe_vars (k, v)
select 'join1', public.apply_join_code((select v from probe_vars where k = 'oak_hash'), 'a1111111-1111-4111-8111-111111111111', 'Sam Reed', 'fixer', 'samreed', '203.0.113.11', 'probe')::text;
insert into probe_vars (k, v)
select 'join2', public.apply_join_code((select v from probe_vars where k = 'oak_hash'), 'a2222222-2222-4222-8222-222222222222', 'Lee Join', 'fixer', 'leejoin', '203.0.113.12', 'probe')::text;
insert into probe_vars (k, v)
select 'join3', public.apply_join_code((select v from probe_vars where k = 'oak_hash'), 'a3333333-3333-4333-8333-333333333333', 'Nia Join', 'fixer', 'niajoin', '203.0.113.13', 'probe')::text;
insert into probe_vars (k, v)
select 'join4', public.apply_join_code((select v from probe_vars where k = 'oak_hash'), 'a4444444-4444-4444-8444-444444444444', 'Fourth Lad', 'fixer', 'fourthlad', '203.0.113.14', 'probe')::text;
insert into probe_vars (k, v)
select 'wrong', public.apply_join_code(pg_temp.code_hash('ZZZZZZZZ'), 'a4444444-4444-4444-8444-444444444444', 'Nope', 'fixer', 'nopeuser', '203.0.113.20', 'probe')::text;
insert into probe_vars (k, v)
select 'expired', public.apply_join_code((select v from probe_vars where k = 'expire_hash'), 'a4444444-4444-4444-8444-444444444444', 'Nope', 'fixer', 'nopeuser', '203.0.113.21', 'probe')::text;
insert into probe_vars (k, v)
select 'revoked', public.apply_join_code((select v from probe_vars where k = 'revoke_hash'), 'a4444444-4444-4444-8444-444444444444', 'Nope', 'fixer', 'nopeuser', '203.0.113.22', 'probe')::text;

insert into probe_vars (k, v)
select 'lock' || g, public.apply_join_code(pg_temp.code_hash('YYYYYYYY'), 'a4444444-4444-4444-8444-444444444444', 'Nope', 'fixer', 'nopeuser', '198.51.100.10', 'probe')::text
from generate_series(1, 40) g;

insert into probe_vars (k, v)
select 'locked_valid', public.apply_join_code((select v from probe_vars where k = 'open_hash'), 'e1111111-1111-4111-8111-111111111111', 'Still Open', 'fixer', 'openlad', '198.51.100.10', 'probe')::text;
insert into probe_vars (k, v)
select 'other_ip', public.apply_join_code((select v from probe_vars where k = 'open_hash'), 'e1111111-1111-4111-8111-111111111111', 'Still Open', 'fixer', 'openlad', '198.51.100.11', 'probe')::text;

insert into probe_vars (k, v)
select 'v6lock' || g, public.apply_join_code(pg_temp.code_hash('VVVVVVVV'), 'a4444444-4444-4444-8444-444444444444', 'Nope', 'fixer', 'nopeuser', '2001:db8:1:2::' || g, 'probe')::text
from generate_series(1, 40) g;

reset role;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;

insert into probe_vars (k, v)
values (
  'after_ip',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'after ip',
    2,
    24,
    (select v from probe_vars where k = 'after_ip_hash')
  )::text
);

insert into probe_vars (k, v)
values (
  'v6code',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'v6',
    2,
    24,
    (select v from probe_vars where k = 'v6_hash')
  )::text
);

reset role;
select pg_temp.as_user(null, 'service_role');
set local role service_role;

insert into probe_vars (k, v)
select 'v6join', public.apply_join_code((select v from probe_vars where k = 'v6_hash'), 'c1111111-1111-4111-8111-111111111111', 'V6 Lad', 'fixer', 'v6lad', '2001:0db8:0001:0002::99', 'probe')::text;
insert into probe_vars (k, v)
select 'v6other', public.apply_join_code((select v from probe_vars where k = 'v6_hash'), 'c1111111-1111-4111-8111-111111111111', 'V6 Lad', 'fixer', 'v6lad', '2001:db8:9:9::1', 'probe')::text;

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select v::jsonb->>'ok' from probe_vars where k = 'join1') = 'true'
  and (select v::jsonb->>'ok' from probe_vars where k = 'join2') = 'true'
  and (select v::jsonb->>'ok' from probe_vars where k = 'join3') = 'true'
  and (select v::jsonb->>'error' from probe_vars where k = 'join4') = 'join_rejected'
  and (select uses from public.join_codes where id = ((select v::jsonb->>'id' from probe_vars where k = 'oak')::uuid)) = 3
  and (select count(*) from public.people where username = 'fourthlad') = 0
  and (select v::jsonb from probe_vars where k = 'wrong') = (select v::jsonb from probe_vars where k = 'expired')
  and (select v::jsonb from probe_vars where k = 'wrong') = (select v::jsonb from probe_vars where k = 'revoked')
  and (select v::jsonb from probe_vars where k = 'wrong') = (select v::jsonb from probe_vars where k = 'join4')
  and (select v from probe_vars where k = 'wrong') not like '%Oak%'
  and (select v from probe_vars where k = 'wrong') not like '%Ashfield%',
  'cap of 3 holds and bad codes look the same'
);

select pg_temp.ok(
  (select v::jsonb->>'error' from probe_vars where k = 'locked_valid') = 'rate_limited'
  and (select v::jsonb->>'ok' from probe_vars where k = 'other_ip') = 'true'
  and exists (
    select 1 from public.join_rate_limits
    where bucket = 'ip' and subject = '198.51.100.10' and kind = 'alert'
  )
  and (select count(*) from public.people where username = 'openlad') = 1,
  'a hot IP hard-limits that address and another IP still joins'
);

select pg_temp.ok(
  (select v::jsonb->>'error' from probe_vars where k = 'v6join') = 'rate_limited'
  and (select v::jsonb->>'ok' from probe_vars where k = 'v6other') = 'true'
  and exists (
    select 1 from public.join_rate_limits
    where bucket = 'ip' and subject = '2001:0db8:0001:0002' and kind = 'alert'
  )
  and (select count(*) from public.people where username = 'v6lad') = 1,
  'ipv6 /64 hard-limits that prefix and another prefix still joins'
);

select pg_temp.ok(
  (select role from public.people where username = 'samreed') = 'operative'
  and (select email from public.people where username = 'samreed') is null
  and (
    select count(*) from public.site_assignments a
    join public.people p on p.id = a.person_id
    where p.username = 'samreed' and a.site_id = '66666666-6666-6666-6666-666666666666'
  ) = 1,
  'join scopes only to the code company and site'
);

-- Global counter alerts and does not reject.
insert into public.join_rate_limits (bucket, subject, kind)
select 'global', 'all', 'failure'
from generate_series(1, greatest(0, 99 - private.join_failure_count('global', 'all', interval '10 minutes')));

select pg_temp.as_user(null, 'service_role');
set local role service_role;

insert into probe_vars (k, v)
values ('burst', public.apply_join_code(pg_temp.code_hash('XXXXXXXX'), 'a4444444-4444-4444-8444-444444444444', 'Nope', 'fixer', 'nopeuser', '198.51.100.200', 'probe')::text);

reset role;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;

insert into probe_vars (k, v)
values (
  'after_global',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'after global',
    2,
    24,
    (select v from probe_vars where k = 'after_global_hash')
  )::text
);

reset role;
select pg_temp.as_user(null, 'service_role');
set local role service_role;

insert into probe_vars (k, v)
select 'after_global_join', public.apply_join_code(
  (select v from probe_vars where k = 'after_global_hash'),
  'e2222222-2222-4222-8222-222222222222',
  'After Global',
  'fixer',
  'afterglob',
  '198.51.100.201',
  'probe'
)::text;

select public.note_login_failure('bentorres', '203.0.113.9') from generate_series(1, 10) g;

insert into probe_vars (k, v)
values ('bentorres_locked', public.lookup_username_login('bentorres', '203.0.113.9')::text);

insert into probe_vars (k, v)
values ('sam_login', public.lookup_username_login('samreed', '203.0.113.10')::text);

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select v::jsonb->>'error' from probe_vars where k = 'burst') = 'join_rejected'
  and coalesce((select v::jsonb->>'delay_ms' from probe_vars where k = 'burst')::int, 0) > 0
  and private.join_failure_count('global', 'all', interval '10 minutes') >= 100
  and exists (select 1 from public.join_rate_limits where bucket = 'global' and subject = 'all' and kind = 'alert')
  and (select v::jsonb->>'ok' from probe_vars where k = 'after_global_join') = 'true'
  and (select count(*) from public.people where username = 'afterglob') = 1,
  'global failure counter alerts and does not reject a valid code'
);

select pg_temp.ok(
  (select v::jsonb->>'error' from probe_vars where k = 'bentorres_locked') = 'sign_in_failed'
  and (select v::jsonb->>'ok' from probe_vars where k = 'sam_login') = 'true'
  and (select v from probe_vars where k = 'sam_login') not like '%@%',
  'username limit locks that name only and hides email'
);

-- Service guard rejects a non-service caller even after a grant.
grant execute on function public.apply_join_code(text, uuid, text, text, text, text, text) to authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;

do $$
begin
  perform public.apply_join_code('00', 'a4444444-4444-4444-8444-444444444444', 'Nope', 'fixer', 'nopeuser', '203.0.113.1', 'probe');
  raise exception 'FAIL: authenticated apply was accepted';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: service guard rejects authenticated';
end $$;

reset role;
revoke execute on function public.apply_join_code(text, uuid, text, text, text, text, text) from authenticated;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role service_role;

insert into probe_vars (k, v)
select 'claims_win', public.username_is_taken(
  'samreed',
  (select v from probe_vars where k = 'after_ip_hash'),
  '203.0.113.50'
)::text;

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select v::jsonb->>'taken' from probe_vars where k = 'claims_win') = 'true',
  'claims role service_role wins over the legacy claim'
);

-- Archived site codes are dead.
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;
select public.archive_site('66666666-6666-6666-6666-666666666666', true);

do $$
begin
  perform public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'archived',
    2,
    24,
    (select v from probe_vars where k = 'arch_hash')
  );
  raise exception 'FAIL: archived site accepted a code';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: archived site cannot issue a code';
end $$;

reset role;
select pg_temp.as_user(null, 'service_role');
set local role service_role;

insert into probe_vars (k, v)
select 'archived_join', public.apply_join_code(
  (select v from probe_vars where k = 'after_ip_hash'),
  'e3333333-3333-4333-8333-333333333333',
  'Archived',
  'fixer',
  'archlad',
  '203.0.113.77',
  'probe'
)::text;

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select v::jsonb->>'error' from probe_vars where k = 'archived_join') = 'join_rejected'
  and (select count(*) from public.people where username = 'archlad') = 0,
  'an archived site kills an existing code'
);

select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;
select public.archive_site('66666666-6666-6666-6666-666666666666', false);
reset role;
select pg_temp.as_user(null, '');

-- CM remove is site-scoped and cannot touch owner-invited staff.
select pg_temp.as_user('33333333-3333-3333-3333-333333333333', 'authenticated');
set local role authenticated;

insert into probe_vars (k, v)
values (
  'cm_code',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'cm crew',
    2,
    24,
    (select v from probe_vars where k = 'cm_hash')
  )::text
);

do $$
begin
  perform public.remove_joiner('44444444-4444-4444-4444-444444444444', '66666666-6666-6666-6666-666666666666', false);
  raise exception 'FAIL: CM removed owner-invited staff';
exception
  when others then
    if sqlerrm <> 'not_authorized' then
      raise;
    end if;
    raise notice 'ok: CM cannot remove staff the owner invited';
end $$;

reset role;
select pg_temp.as_user(null, 'service_role');
set local role service_role;

insert into probe_vars (k, v)
select 'cm_join', public.apply_join_code(
  (select v from probe_vars where k = 'cm_hash'),
  'd1111111-1111-4111-8111-111111111111',
  'Cm Lad',
  'fixer',
  'cmlad',
  '203.0.113.88',
  'probe'
)::text;

reset role;
select pg_temp.as_user(null, '');

insert into probe_vars (k, v)
select 'cmlad_id', id::text from public.people where username = 'cmlad';

insert into public.site_assignments (site_id, person_id)
select '77777777-7777-7777-7777-777777777777', v::uuid from probe_vars where k = 'cmlad_id';

insert into auth.sessions (id, user_id)
values ('c2222222-2222-4222-8222-222222222222', 'd1111111-1111-4111-8111-111111111111');

select pg_temp.as_user('33333333-3333-3333-3333-333333333333', 'authenticated');
set local role authenticated;

select public.remove_joiner((select v::uuid from probe_vars where k = 'cmlad_id'), '66666666-6666-6666-6666-666666666666', false);

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select count(*) from public.people where username = 'cmlad') = 1
  and (select banned_until from auth.users where id = 'd1111111-1111-4111-8111-111111111111') is null
  and (select count(*) from auth.sessions where user_id = 'd1111111-1111-4111-8111-111111111111') = 1
  and not exists (
    select 1 from public.site_assignments a
    join public.people p on p.id = a.person_id
    where p.username = 'cmlad' and a.site_id = '66666666-6666-6666-6666-666666666666'
  )
  and exists (
    select 1 from public.site_assignments a
    join public.people p on p.id = a.person_id
    where p.username = 'cmlad' and a.site_id = '77777777-7777-7777-7777-777777777777'
  ),
  'CM remove drops only their site and does not ban'
);

-- Joiner cannot see coworker usernames.
select pg_temp.as_user('a1111111-1111-4111-8111-111111111111', 'authenticated');
set local role authenticated;

select pg_temp.ok(
  exists (select 1 from public.people_directory where id = '44444444-4444-4444-4444-444444444444')
  and not exists (select 1 from public.people_directory where id = 'd10d10d1-0d10-4d10-8d10-d10d10d10d10'),
  'joiner sees people on their site only'
);

do $$
begin
  perform username from public.people;
  raise exception 'FAIL: joiner read username';
exception
  when insufficient_privilege then
    raise notice 'ok: joiner cannot read username';
end $$;

reset role;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;

select pg_temp.ok(
  (select public.company_people() @> jsonb_build_array(jsonb_build_object('username', 'bentorres')))
  or exists (
    select 1
    from jsonb_array_elements(public.company_people()) row
    where row->>'username' = 'bentorres'
  ),
  'owner labour list includes usernames'
);

reset role;
select pg_temp.as_user(null, '');

-- Reset codes: hash in, per-target limit, single use.
insert into probe_vars (k, v)
select 'sam_id', id::text from public.people where username = 'samreed';
insert into probe_vars (k, v)
select 'nia_id', id::text from public.people where username = 'niajoin';
insert into probe_vars (k, v)
select 'lee_id', id::text from public.people where username = 'leejoin';

select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;

insert into probe_vars (k, v) values ('reset_plain', pg_temp.mint()), ('reset2_plain', pg_temp.mint()), ('nia_plain', pg_temp.mint());
insert into probe_vars (k, v)
select replace(k, '_plain', '_hash'), pg_temp.code_hash(v) from probe_vars where k in ('reset_plain', 'reset2_plain', 'nia_plain');

insert into probe_vars (k, v)
values ('reset1', public.reset_password_code((select v::uuid from probe_vars where k = 'sam_id'), (select v from probe_vars where k = 'reset_hash'))::text);
insert into probe_vars (k, v)
values ('reset2', public.reset_password_code((select v::uuid from probe_vars where k = 'sam_id'), (select v from probe_vars where k = 'reset2_hash'))::text);

do $$
begin
  perform public.reset_password_code('22222222-2222-2222-2222-222222222222', pg_temp.code_hash(pg_temp.mint()));
  raise exception 'FAIL: owner reset the owner';
exception
  when others then
    if sqlerrm <> 'not_authorized' then raise; end if;
    raise notice 'ok: owner cannot reset the owner account';
end $$;

reset role;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333', 'authenticated');
set local role authenticated;

do $$
begin
  perform public.reset_password_code('22222222-2222-2222-2222-222222222222', pg_temp.code_hash(pg_temp.mint()));
  raise exception 'FAIL: CM reset the owner';
exception
  when others then
    if sqlerrm <> 'not_authorized' then raise; end if;
    raise notice 'ok: CM cannot reset the owner';
end $$;

reset role;
select pg_temp.as_user(null, '');

insert into auth.sessions (id, user_id)
values ('b1111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111');
insert into auth.refresh_tokens (token, user_id, session_id)
values ('sam-token', 'a1111111-1111-4111-8111-111111111111', 'b1111111-1111-4111-8111-111111111111');

select pg_temp.as_user(null, 'service_role');
set local role service_role;

insert into probe_vars (k, v)
select 'redeem_old', public.redeem_password_reset((select v from probe_vars where k = 'reset_hash'), '203.0.113.40')::text;
insert into probe_vars (k, v)
select 'redeem_ok', public.redeem_password_reset((select v from probe_vars where k = 'reset2_hash'), '203.0.113.41')::text;

insert into probe_vars (k, v)
select 'redeem_fail' || g, public.redeem_password_reset((select v from probe_vars where k = 'reset2_hash'), '203.0.113.41')::text
from generate_series(1, 10) g;

reset role;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;

insert into probe_vars (k, v) values ('reset3_plain', pg_temp.mint());
insert into probe_vars (k, v) values ('reset3_hash', pg_temp.code_hash((select v from probe_vars where k = 'reset3_plain')));
insert into probe_vars (k, v)
values ('reset3', public.reset_password_code((select v::uuid from probe_vars where k = 'sam_id'), (select v from probe_vars where k = 'reset3_hash'))::text);
insert into probe_vars (k, v)
values ('nia_reset', public.reset_password_code((select v::uuid from probe_vars where k = 'nia_id'), (select v from probe_vars where k = 'nia_hash'))::text);

reset role;
select pg_temp.as_user(null, 'service_role');
set local role service_role;

insert into probe_vars (k, v)
select 'sam_blocked', public.redeem_password_reset((select v from probe_vars where k = 'reset3_hash'), '203.0.113.70')::text;
insert into probe_vars (k, v)
select 'nia_ok', public.redeem_password_reset((select v from probe_vars where k = 'nia_hash'), '203.0.113.71')::text;

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select v::jsonb->>'error' from probe_vars where k = 'redeem_old') = 'reset_rejected'
  and (select v::jsonb->>'ok' from probe_vars where k = 'redeem_ok') = 'true'
  and (select v::jsonb->>'error' from probe_vars where k = 'sam_blocked') = 'reset_rejected'
  and (select v::jsonb->>'ok' from probe_vars where k = 'nia_ok') = 'true'
  and (select count(*) from auth.sessions where user_id = 'a1111111-1111-4111-8111-111111111111') = 0
  and (select password_reset_at from public.people where username = 'niajoin') is not null,
  'per-target reset limit locks that person only'
);

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000000',
  'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0',
  'authenticated',
  'authenticated',
  'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0@users.sitepack.invalid',
  now(),
  now()
);

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

-- Owner remove still bans.
insert into auth.sessions (id, user_id)
values ('b2222222-2222-4222-8222-222222222222', 'a2222222-2222-4222-8222-222222222222');
insert into auth.refresh_tokens (token, user_id, session_id)
values ('lee-token', 'a2222222-2222-4222-8222-222222222222', 'b2222222-2222-4222-8222-222222222222');

select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;
select public.remove_joiner((select v::uuid from probe_vars where k = 'lee_id'), '66666666-6666-6666-6666-666666666666', true);
reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select count(*) from public.people where username = 'leejoin') = 0
  and (select banned_until from auth.users where id = 'a2222222-2222-4222-8222-222222222222') = 'infinity'
  and (select count(*) from auth.sessions where user_id = 'a2222222-2222-4222-8222-222222222222') = 0
  and (select revoked_at from public.join_codes where id = ((select v::jsonb->>'id' from probe_vars where k = 'oak')::uuid)) is not null,
  'owner remove bans the login and can revoke the code'
);

select pg_temp.ok(
  exists (select 1 from public.join_audit where action = 'attempt')
  and exists (select 1 from public.join_audit where action = 'join')
  and exists (select 1 from public.join_audit where action = 'remove'),
  'audit covers attempt, join, and remove'
);

-- Round 2: hard IP cap, mapped addresses, unknown bucket, username gating, reset once.
set local statement_timeout = 0;

insert into probe_vars (k, v) values
  ('other_plain', pg_temp.mint()),
  ('unk_plain', pg_temp.mint()),
  ('share_old_plain', pg_temp.mint()),
  ('share_new_plain', pg_temp.mint()),
  ('rio_plain', pg_temp.mint()),
  ('ben_plain', pg_temp.mint()),
  ('name_b_plain', pg_temp.mint()),
  ('crew_plain', pg_temp.mint());

insert into probe_vars (k, v)
select replace(k, '_plain', '_hash'), pg_temp.code_hash(v)
from probe_vars
where k in (
  'other_plain', 'unk_plain', 'share_old_plain', 'share_new_plain',
  'rio_plain', 'ben_plain', 'name_b_plain', 'crew_plain'
);

select pg_temp.as_user('22222222-2222-2222-2222-222222222222', 'authenticated');
set local role authenticated;

insert into probe_vars (k, v)
values (
  'other_code',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'other ip',
    2,
    24,
    (select v from probe_vars where k = 'other_hash')
  )::text
);
insert into probe_vars (k, v)
values (
  'unk_code',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'unknown ip',
    2,
    24,
    (select v from probe_vars where k = 'unk_hash')
  )::text
);
insert into probe_vars (k, v)
values (
  'share_old',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'share again',
    2,
    24,
    (select v from probe_vars where k = 'share_old_hash')
  )::text
);
insert into probe_vars (k, v)
values (
  'share_new',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'share again',
    2,
    24,
    (select v from probe_vars where k = 'share_new_hash')
  )::text
);
insert into probe_vars (k, v)
values (
  'name_b',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'other code',
    2,
    24,
    (select v from probe_vars where k = 'name_b_hash')
  )::text
);
insert into probe_vars (k, v)
values (
  'crew_code',
  public.create_join_code(
    '66666666-6666-6666-6666-666666666666',
    'crew',
    25,
    24,
    (select v from probe_vars where k = 'crew_hash')
  )::text
);

select public.revoke_join_code((select (v::jsonb->>'id')::uuid from probe_vars where k = 'share_old'));

insert into probe_vars (k, v)
values (
  'rio_issue',
  public.reset_password_code(
    'd10d10d1-0d10-4d10-8d10-d10d10d10d10',
    (select v from probe_vars where k = 'rio_hash')
  )::text
);
insert into probe_vars (k, v)
values (
  'ben_issue',
  public.reset_password_code(
    '55555555-5555-5555-5555-555555555555',
    (select v from probe_vars where k = 'ben_hash')
  )::text
);

reset role;
select pg_temp.as_user(null, 'service_role');
set local role service_role;

do $$
declare
  v_row jsonb;
  i integer;
begin
  for i in 1..40 loop
    v_row := public.apply_join_code(
      repeat('aa', 32),
      'a4444444-4444-4444-8444-444444444444',
      'Nope',
      'fixer',
      'nopeuser',
      '203.0.113.60',
      'probe'
    );
    if v_row->>'error' is distinct from 'join_rejected' then
      raise exception 'FAIL: mapped warmup % %', i, v_row;
    end if;
  end loop;
end $$;

insert into probe_vars (k, v)
select 'mapped_block', public.apply_join_code(
  repeat('aa', 32),
  'a4444444-4444-4444-8444-444444444444',
  'Nope',
  'fixer',
  'nopeuser',
  '::ffff:203.0.113.60',
  'probe'
)::text;
insert into probe_vars (k, v)
select 'mapped_long', public.apply_join_code(
  repeat('aa', 32),
  'a4444444-4444-4444-8444-444444444444',
  'Nope',
  'fixer',
  'nopeuser',
  '0:0:0:0:0:ffff:203.0.113.60',
  'probe'
)::text;

do $$
declare
  v_row jsonb;
  v_rejected integer := 0;
  v_limited integer := 0;
  v_other integer := 0;
  i integer;
begin
  for i in 1..2000 loop
    v_row := public.apply_join_code(
      repeat('ab', 32),
      'a4444444-4444-4444-8444-444444444444',
      'Nope',
      'fixer',
      'nopeuser',
      '203.0.113.90',
      'probe'
    );
    if v_row->>'error' = 'join_rejected' then
      v_rejected := v_rejected + 1;
    elsif v_row->>'error' = 'rate_limited' then
      v_limited := v_limited + 1;
    else
      v_other := v_other + 1;
    end if;
  end loop;
  if v_rejected <> 40 or v_limited <> 1960 or v_other <> 0 then
    raise exception 'FAIL: 2000 guesses rejected % limited % other %', v_rejected, v_limited, v_other;
  end if;
  raise notice 'ok: 2000 wrong guesses from one IP cap at 40';
end $$;

insert into probe_vars (k, v)
select 'other_join', public.apply_join_code(
  (select v from probe_vars where k = 'other_hash'),
  'e3333333-3333-4333-8333-333333333333',
  'Other Lad',
  'fixer',
  'otherlad',
  '203.0.113.91',
  'probe'
)::text;

do $$
declare
  v_row jsonb;
  v_rejected integer := 0;
  v_limited integer := 0;
  i integer;
begin
  for i in 1..45 loop
    v_row := public.apply_join_code(
      repeat('ac', 32),
      'a4444444-4444-4444-8444-444444444444',
      'Nope',
      'fixer',
      'nopeuser',
      'not-an-ip',
      'probe'
    );
    if v_row->>'error' = 'join_rejected' then
      v_rejected := v_rejected + 1;
    elsif v_row->>'error' = 'rate_limited' then
      v_limited := v_limited + 1;
    end if;
  end loop;
  if v_rejected <> 45 or v_limited <> 0 then
    raise exception 'FAIL: unknown bucket rejected % limited %', v_rejected, v_limited;
  end if;
  raise notice 'ok: unknown IP bucket is not hard-capped';
end $$;

insert into probe_vars (k, v)
select 'unk_join', public.apply_join_code(
  (select v from probe_vars where k = 'unk_hash'),
  'a4444444-4444-4444-8444-444444444444',
  'Unknown Lad',
  'fixer',
  'unklad',
  'not-an-ip',
  'probe'
)::text;

insert into probe_vars (k, v)
select 'name_dead', public.username_is_taken('samreed', repeat('cd', 32), '203.0.113.81')::text;

do $$
declare
  v_hash text;
  v_other text;
  v_row jsonb;
  v_taken integer := 0;
  i integer;
begin
  select v into v_hash from probe_vars where k = 'after_ip_hash';
  select v into v_other from probe_vars where k = 'name_b_hash';
  for i in 1..40 loop
    v_row := public.username_is_taken('samreed', v_hash, '203.0.113.80');
    if v_row->>'ok' = 'true' and v_row->>'taken' = 'true' then
      v_taken := v_taken + 1;
    else
      raise exception 'FAIL: username lookup % %', i, v_row;
    end if;
  end loop;
  v_row := public.username_is_taken('samreed', v_hash, '203.0.113.80');
  if v_row->>'error' is distinct from 'rate_limited' or v_taken <> 40 then
    raise exception 'FAIL: username throttle % after %', v_row, v_taken;
  end if;
  v_row := public.username_is_taken('samreed', v_other, '203.0.113.80');
  if v_row->>'ok' is distinct from 'true' or v_row->>'taken' is distinct from 'true' then
    raise exception 'FAIL: other code was throttled %', v_row;
  end if;
  v_row := public.username_is_taken('freshlad80', v_hash, '203.0.113.80');
  if v_row->>'ok' is distinct from 'true' or v_row->>'taken' is distinct from 'false' then
    raise exception 'FAIL: free name was throttled %', v_row;
  end if;
  raise notice 'ok: taken usernames cap per code and IP, a free name and another code do not';
end $$;

reset role;
select pg_temp.as_user(null, '');

alter table public.join_codes drop constraint join_codes_max_uses_range;
update public.join_codes
set max_uses = 80
where id = (select (v::jsonb->>'id')::uuid from probe_vars where k = 'crew_code');

create temp table probe_crew (n int primary key, auth_id uuid, username text);
grant all on table probe_crew to service_role;
insert into probe_crew (n, auth_id, username)
select g, gen_random_uuid(), 'crew' || lpad(g::text, 2, '0')
from generate_series(1, 60) g;

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  auth_id,
  'authenticated',
  'authenticated',
  auth_id::text || '@users.sitepack.invalid',
  now(),
  now()
from probe_crew;

select pg_temp.as_user(null, 'service_role');
set local role service_role;

do $$
declare
  v_hash text;
  v_row jsonb;
  r record;
begin
  select v into v_hash from probe_vars where k = 'crew_hash';
  for r in select * from probe_crew order by n loop
    v_row := public.username_is_taken(r.username, v_hash, '203.0.113.120');
    if v_row->>'ok' is distinct from 'true' or v_row->>'taken' is distinct from 'false' then
      raise exception 'FAIL: crew lookup % %', r.n, v_row;
    end if;
    v_row := public.apply_join_code(
      v_hash, r.auth_id, 'Crew ' || r.n, 'fixer', r.username, '203.0.113.120', 'probe'
    );
    if v_row->>'ok' is distinct from 'true' then
      raise exception 'FAIL: crew join % %', r.n, v_row;
    end if;
  end loop;
  raise notice 'ok: 60 genuine joins from one IP all succeed';
end $$;

do $$
declare
  v_row jsonb;
  v_rejected integer := 0;
  v_limited integer := 0;
  v_other integer := 0;
  i integer;
begin
  for i in 1..500 loop
    v_row := public.redeem_password_reset(repeat('ef', 32), '198.51.100.250');
    if v_row->>'error' = 'reset_rejected' then
      v_rejected := v_rejected + 1;
    elsif v_row->>'error' = 'rate_limited' then
      v_limited := v_limited + 1;
    else
      v_other := v_other + 1;
    end if;
  end loop;
  if v_rejected <> 40 or v_limited <> 460 or v_other <> 0 then
    raise exception 'FAIL: reset guesses rejected % limited % other %', v_rejected, v_limited, v_other;
  end if;
  raise notice 'ok: reset guesses cap on the IP and ignore the code hash';
end $$;

insert into probe_vars (k, v)
select 'rio_ok', public.redeem_password_reset((select v from probe_vars where k = 'rio_hash'), '198.51.100.60')::text;
insert into probe_vars (k, v)
select 'rio_again', public.redeem_password_reset((select v from probe_vars where k = 'rio_hash'), '198.51.100.61')::text;

insert into probe_vars (k, v)
select 'ben_ok', public.redeem_password_reset((select v from probe_vars where k = 'ben_hash'), '198.51.100.62')::text;

select public.release_password_reset((select (v::jsonb->>'reset_id')::uuid from probe_vars where k = 'ben_issue'));

reset role;
select pg_temp.as_user(null, '');

select pg_temp.ok(
  (select v::jsonb->>'error' from probe_vars where k = 'mapped_block') = 'rate_limited'
  and (select v::jsonb->>'error' from probe_vars where k = 'mapped_long') = 'rate_limited'
  and private.join_failure_count('ip', '203.0.113.60', interval '15 minutes') = 40,
  'ipv4-mapped addresses share the IPv4 failure cap'
);

select pg_temp.ok(
  private.join_failure_count('ip', '203.0.113.90', interval '15 minutes') = 40
  and (select v::jsonb->>'ok' from probe_vars where k = 'other_join') = 'true'
  and (select count(*) from public.people where username = 'otherlad') = 1,
  '2000 wrong guesses cap at 40 and another IP still joins'
);

select pg_temp.ok(
  (select v::jsonb->>'ok' from probe_vars where k = 'unk_join') = 'true'
  and (select count(*) from public.people where username = 'unklad') = 1
  and private.join_failure_count('ip', 'unknown', interval '15 minutes') >= 45,
  'unknown IP is not hard-capped and a valid code still joins'
);

select pg_temp.ok(
  (select count(*) from public.people where username like 'crew%') = 60
  and (select uses from public.join_codes where id = (select (v::jsonb->>'id')::uuid from probe_vars where k = 'crew_code')) = 60
  and private.join_failure_count(
    'username_lookup',
    private.username_lookup_subject(
      (select (v::jsonb->>'id')::uuid from probe_vars where k = 'crew_code'),
      '203.0.113.120'
    ),
    interval '15 minutes'
  ) = 0,
  '60 fresh joins from one IP succeed and do not fill the taken-username cap'
);

select pg_temp.ok(
  (select v::jsonb->>'error' from probe_vars where k = 'name_dead') = 'join_rejected'
  and (select v::jsonb->>'taken' from probe_vars where k = 'name_dead') = 'false'
  and private.join_failure_count(
    'username_lookup',
    private.username_lookup_subject(
      (select (v::jsonb->>'id')::uuid from probe_vars where k = 'after_ip'),
      '203.0.113.80'
    ),
    interval '15 minutes'
  ) = 40
  and private.join_failure_count(
    'username_lookup',
    private.username_lookup_subject(
      (select (v::jsonb->>'id')::uuid from probe_vars where k = 'name_b'),
      '203.0.113.80'
    ),
    interval '15 minutes'
  ) = 1,
  'a dead code does not reveal a taken username, and taken answers cap per code and IP'
);

select pg_temp.ok(
  private.join_failure_count('reset_ip', '198.51.100.250', interval '15 minutes') = 40
  and (select count(*) from public.join_rate_limits where bucket = 'reset_code') = 0,
  'reset limit is the IP, never the guessed code hash'
);

select pg_temp.ok(
  (select v::jsonb->>'ok' from probe_vars where k = 'rio_ok') = 'true'
  and (select v::jsonb->>'error' from probe_vars where k = 'rio_again') = 'reset_rejected'
  and (
    select used_at is not null
    from public.password_reset_codes
    where code_hash = decode((select v from probe_vars where k = 'rio_hash'), 'hex')
  ),
  'reset code redeems once'
);

select pg_temp.ok(
  (select v::jsonb->>'ok' from probe_vars where k = 'ben_ok') = 'true'
  and (
    select used_at is null
    from public.password_reset_codes
    where id = (select (v::jsonb->>'reset_id')::uuid from probe_vars where k = 'ben_issue')
  )
  and (
    select count(*)
    from public.join_audit
    where action = 'reset_redeem'
      and detail->>'reset_id' = (select v::jsonb->>'reset_id' from probe_vars where k = 'ben_issue')
  ) = 1
  and exists (
    select 1
    from public.join_audit
    where action = 'reset_release'
      and detail->>'reset_id' = (select v::jsonb->>'reset_id' from probe_vars where k = 'ben_issue')
  ),
  'releasing a reset appends reset_release and keeps the redeem audit'
);

select pg_temp.ok(
  (
    select revoked_at is not null
    from public.join_codes
    where id = (select (v::jsonb->>'id')::uuid from probe_vars where k = 'share_old')
  )
  and (
    select revoked_at is null
    from public.join_codes
    where id = (select (v::jsonb->>'id')::uuid from probe_vars where k = 'share_new')
  )
  and (
    select count(*)
    from public.join_codes
    where label = 'share again' and revoked_at is null
  ) = 1
  and exists (
    select 1
    from public.join_audit
    where action = 'code_revoke'
      and detail->>'code_id' = (select v::jsonb->>'id' from probe_vars where k = 'share_old')
  ),
  'share again revokes the old code and audits code_revoke'
);

rollback;

-- ---------------------------------------------------------------------------
-- Concurrent cap. Committed so the other connections can see the code row.
-- ---------------------------------------------------------------------------

create extension if not exists dblink;
select set_config('app.probe_conn', :'probe_conn', false);

create temp table probe_race (plain text, hash text, payload jsonb);
grant all on table probe_race to authenticated;

do $$
declare
  v_code text := pg_temp.mint();
begin
  insert into probe_race (plain, hash) values (v_code, pg_temp.code_hash(v_code));
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
  false
);

set role authenticated;
update probe_race
set payload = public.create_join_code(
  '66666666-6666-6666-6666-666666666666',
  'race',
  3,
  24,
  hash
);
reset role;

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'c0de0001-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'c0de0001-0000-4000-8000-000000000001@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0de0002-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'c0de0002-0000-4000-8000-000000000002@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0de0003-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'c0de0003-0000-4000-8000-000000000003@users.sitepack.invalid', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0de0004-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'c0de0004-0000-4000-8000-000000000004@users.sitepack.invalid', now(), now());

do $$
declare
  v_hash text;
  i int;
  auth_ids uuid[] := array[
    'c0de0001-0000-4000-8000-000000000001',
    'c0de0002-0000-4000-8000-000000000002',
    'c0de0003-0000-4000-8000-000000000003',
    'c0de0004-0000-4000-8000-000000000004'
  ]::uuid[];
begin
  select hash into v_hash from probe_race limit 1;
  for i in 1..4 loop
    perform dblink_connect('race' || i, current_setting('app.probe_conn'));
    perform dblink_send_query(
      'race' || i,
      format(
        'with cfg as (select set_config(''request.jwt.claims'', ''{"role":"service_role"}'', true), set_config(''request.jwt.claim.role'', '''', true)) select public.apply_join_code(%L, %L::uuid, %L, %L, %L, %L, %L) from cfg',
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
  and (select count(*) from public.people where username like 'racer%') = 3,
  'four concurrent joins on a cap of 3 let exactly three through'
);
