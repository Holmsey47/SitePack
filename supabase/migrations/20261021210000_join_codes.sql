-- Join codes. A lad with a link or a short code joins one site as an operative.
-- No approval step. The code is the invite.
--
-- M1 (people visibility) and M10 (site_contracts_manager_names revoke) already
-- shipped in 20261021163528_pre_lad_security.sql. This migration does not
-- repeat them.
--
-- The plaintext code is generated in a logged-in edge function. That function
-- HMACs it with the edge secret and passes only the hash to SQL. SQL never
-- reads a pepper and never returns the plaintext.
--
-- Re-runnable: tables use if not exists, policies are dropped first, functions
-- are create or replace.

-- ---------------------------------------------------------------------------
-- People: username for sign-in, and a notice after a password reset.
-- ---------------------------------------------------------------------------

alter table public.people add column if not exists username text;
alter table public.people add column if not exists password_reset_at timestamptz;

comment on column public.people.username is
  'Sign-in name. Unique, case-insensitive, stored lower-case. Not an email.';

comment on column public.people.password_reset_at is
  'Set when a reset code is redeemed. The app shows it, then the person clears it.';

alter table public.people drop constraint if exists people_username_shape;
alter table public.people
  add constraint people_username_shape
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,23}$');

create unique index if not exists people_username_lower_idx
  on public.people (lower(username));

-- A signed-in person cannot change the username. The join RPC has no auth.uid().
create or replace function private.protect_people_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'not_authorized';
  end if;
  if new.company_id is distinct from old.company_id then
    raise exception 'not_authorized';
  end if;
  if new.auth_user_id is distinct from old.auth_user_id and auth.uid() is not null then
    raise exception 'not_authorized';
  end if;
  if new.username is distinct from old.username and auth.uid() is not null then
    raise exception 'not_authorized';
  end if;
  if new.role is distinct from old.role and coalesce(private.my_role(), '') <> 'owner' then
    raise exception 'not_authorized';
  end if;
  return new;
end;
$$;

-- Directory stays free of email, phone, and username. A person reads their own
-- username from my_person(). Managers read usernames from company_people().
create or replace view public.people_directory
with (security_invoker = true, security_barrier = true)
as
select
  id,
  auth_user_id,
  company_id,
  role,
  trade,
  display_name,
  created_at
from public.people;

comment on view public.people_directory is
  'People the caller may list. No email, phone, or username. Row visibility follows people_select_visible.';

do $acl$
begin
  if to_regclass('public.people') is not null then
    revoke select (username) on table public.people from public, anon, authenticated;
  end if;
  if to_regclass('public.people_directory') is not null then
    revoke all on table public.people_directory from public, anon, authenticated;
    grant select on table public.people_directory to authenticated;
  end if;
end
$acl$;

create or replace function public.my_person()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'auth_user_id', p.auth_user_id,
    'company_id', p.company_id,
    'role', p.role,
    'trade', p.trade,
    'display_name', p.display_name,
    'email', p.email,
    'phone', p.phone,
    'username', p.username,
    'password_reset_at', p.password_reset_at,
    'created_at', p.created_at
  )
  from public.people p
  where p.auth_user_id = (select auth.uid());
$$;

comment on function public.my_person() is
  'The caller''s own people row, including email, phone, username, and password_reset_at.';

revoke all on function public.my_person() from public, anon;
grant execute on function public.my_person() to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.join_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  code_hash bytea not null,
  label text,
  created_by uuid references public.people (id) on delete set null,
  expires_at timestamptz not null,
  max_uses integer not null default 10,
  uses integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists join_codes_hash_idx on public.join_codes (code_hash);
create index if not exists join_codes_site_idx on public.join_codes (site_id, created_at desc);

comment on table public.join_codes is
  'One company and one site. code_hash is HMAC-SHA256 of the normalised code. The plaintext is returned once and not stored.';

comment on column public.join_codes.code_hash is
  'HMAC-SHA256 of the normalised code. Never granted to anon, authenticated, or service_role.';

alter table public.join_codes drop constraint if exists join_codes_max_uses_range;
alter table public.join_codes
  add constraint join_codes_max_uses_range check (max_uses >= 1 and max_uses <= 25);

alter table public.join_codes drop constraint if exists join_codes_uses_nonneg;
alter table public.join_codes
  add constraint join_codes_uses_nonneg check (uses >= 0);

alter table public.join_codes drop constraint if exists join_codes_label_len;
alter table public.join_codes
  add constraint join_codes_label_len
  check (label is null or (char_length(label) between 1 and 40 and label = btrim(label)));

create table if not exists public.join_events (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.join_codes (id) on delete cascade,
  person_id uuid references public.people (id) on delete set null,
  company_id uuid not null references public.companies (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  display_name text,
  trade text,
  username text,
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.people (id) on delete set null,
  auth_user_id uuid
);

create index if not exists join_events_site_idx on public.join_events (site_id, joined_at desc);
create index if not exists join_events_code_idx on public.join_events (code_id);

comment on table public.join_events is
  'Who joined. Name, trade, and username are copied so the list survives removal.';

create table if not exists public.password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  code_hash bytea not null,
  created_by uuid references public.people (id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists password_reset_codes_hash_idx
  on public.password_reset_codes (code_hash);

create index if not exists password_reset_codes_person_idx
  on public.password_reset_codes (person_id, created_at desc);

comment on table public.password_reset_codes is
  'One-time password reset codes. HMAC-SHA256. 30 minutes. Issuing a new code revokes older ones.';

create table if not exists public.join_rate_limits (
  id bigint generated always as identity primary key,
  bucket text not null,
  subject text not null,
  kind text not null,
  created_at timestamptz not null default now(),
  constraint join_rate_limits_kind check (kind in ('failure', 'alert'))
);

create index if not exists join_rate_limits_lookup_idx
  on public.join_rate_limits (bucket, subject, kind, created_at desc);

comment on table public.join_rate_limits is
  'Service-only counters. Per-username and per-reset-target limits reject. IP and global counters only alert. No policies.';

create index if not exists join_rate_limits_created_idx
  on public.join_rate_limits (created_at);

create table if not exists public.join_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  site_id uuid references public.sites (id) on delete set null,
  actor_id uuid references public.people (id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint join_audit_action check (
    action in (
      'code_create',
      'code_revoke',
      'cap_change',
      'join',
      'attempt',
      'remove',
      'reset_issue',
      'reset_redeem',
      'reset_release'
    )
  )
);

create index if not exists join_audit_company_idx
  on public.join_audit (company_id, created_at desc);

comment on table public.join_audit is
  'Owner sees the company. A contracts manager sees their sites. No code plaintext.';

-- ---------------------------------------------------------------------------
-- RLS. code_hash is not selectable. Rate limits and reset hashes have no grants.
-- ---------------------------------------------------------------------------

alter table public.join_codes enable row level security;
alter table public.join_events enable row level security;
alter table public.password_reset_codes enable row level security;
alter table public.join_rate_limits enable row level security;
alter table public.join_audit enable row level security;

revoke all on table public.join_codes from public, anon, authenticated, service_role;
revoke all on table public.join_events from public, anon, authenticated, service_role;
revoke all on table public.password_reset_codes from public, anon, authenticated, service_role;
revoke all on table public.join_rate_limits from public, anon, authenticated, service_role;
revoke all on table public.join_audit from public, anon, authenticated, service_role;

grant select (
  id,
  company_id,
  site_id,
  label,
  created_by,
  expires_at,
  max_uses,
  uses,
  revoked_at,
  created_at
) on table public.join_codes to authenticated;

grant select (
  id,
  code_id,
  person_id,
  company_id,
  site_id,
  display_name,
  trade,
  username,
  joined_at,
  removed_at,
  removed_by,
  auth_user_id
) on table public.join_events to authenticated;

grant select (
  id,
  company_id,
  site_id,
  actor_id,
  action,
  detail,
  created_at
) on table public.join_audit to authenticated;

drop policy if exists join_codes_select on public.join_codes;
create policy join_codes_select
  on public.join_codes for select to authenticated
  using (
    company_id = private.my_company_id()
    and (
      private.my_role() = 'owner'
      or (private.my_role() = 'cm' and private.can_access_site(site_id))
    )
  );

drop policy if exists join_events_select on public.join_events;
create policy join_events_select
  on public.join_events for select to authenticated
  using (
    company_id = private.my_company_id()
    and (
      private.my_role() = 'owner'
      or (private.my_role() = 'cm' and private.can_access_site(site_id))
    )
  );

drop policy if exists join_audit_select on public.join_audit;
create policy join_audit_select
  on public.join_audit for select to authenticated
  using (
    company_id = private.my_company_id()
    and (
      private.my_role() = 'owner'
      or (
        private.my_role() = 'cm'
        and site_id is not null
        and private.can_access_site(site_id)
      )
    )
  );

-- Re-running this file drops the old signatures.
drop function if exists private.join_rate_limited(text, text, text);
drop function if exists public.create_join_code(uuid, text, integer, integer);
drop function if exists public.reset_password_code(uuid);
drop function if exists public.note_login_failure(text);
drop function if exists public.username_is_taken(text);

-- A table created by an earlier draft of this file needs the attempt action.
alter table public.join_audit drop constraint if exists join_audit_action;
alter table public.join_audit
  add constraint join_audit_action check (
    action in (
      'code_create',
      'code_revoke',
      'cap_change',
      'join',
      'attempt',
      'remove',
      'reset_issue',
      'reset_redeem',
      'reset_release'
    )
  );

-- ---------------------------------------------------------------------------
-- Code helpers. Hashing happens in the edge function. SQL only stores hashes.
-- ---------------------------------------------------------------------------

create or replace function private.normalize_join_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g'));
$$;

create or replace function private.ipv4_subject(p_ip text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[];
  n integer;
  i integer;
begin
  if p_ip is null or p_ip !~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' then
    return null;
  end if;
  parts := string_to_array(p_ip, '.');
  if coalesce(array_length(parts, 1), 0) <> 4 then
    return null;
  end if;
  for i in 1..4 loop
    n := parts[i]::integer;
    if n > 255 then
      return null;
    end if;
  end loop;
  return parts[1] || '.' || parts[2] || '.' || parts[3] || '.' || parts[4];
end;
$$;

create or replace function private.ip_subject(p_ip text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_ip, '')));
  head text;
  tail text;
  left_groups text[];
  right_groups text[];
  groups text[] := array[]::text[];
  missing integer;
  i integer;
  piece text;
begin
  if v = '' or v = 'unknown' then
    return 'unknown';
  end if;
  v := regexp_replace(v, '[\[\]]', '', 'g');
  v := split_part(v, '%', 1);
  v := split_part(v, '/', 1);
  -- IPv4-mapped IPv6 (::ffff:a.b.c.d) shares the IPv4 bucket. S4.
  if v ~ '^::ffff:[0-9]{1,3}(\.[0-9]{1,3}){3}$'
     or v ~ '^([0-9a-f]{1,4}:){5}ffff:[0-9]{1,3}(\.[0-9]{1,3}){3}$' then
    return coalesce(private.ipv4_subject(substring(v from '([0-9]{1,3}(\.[0-9]{1,3}){3})$')), 'unknown');
  end if;
  if position(':' in v) = 0 then
    return coalesce(private.ipv4_subject(v), 'unknown');
  end if;
  if (length(v) - length(replace(v, '::', ''))) / 2 > 1 then
    return 'unknown';
  end if;
  if position('::' in v) > 0 then
    head := split_part(v, '::', 1);
    tail := split_part(v, '::', 2);
    if head = '' then
      left_groups := array[]::text[];
    else
      left_groups := string_to_array(head, ':');
    end if;
    if tail = '' then
      right_groups := array[]::text[];
    else
      right_groups := string_to_array(tail, ':');
    end if;
    missing := 8 - coalesce(array_length(left_groups, 1), 0) - coalesce(array_length(right_groups, 1), 0);
    if missing < 0 then
      return 'unknown';
    end if;
    groups := left_groups;
    if missing > 0 then
      groups := groups || array_fill('0'::text, array[missing]);
    end if;
    groups := groups || right_groups;
  else
    groups := string_to_array(v, ':');
  end if;
  if coalesce(array_length(groups, 1), 0) <> 8 then
    return 'unknown';
  end if;
  for i in 1..4 loop
    piece := groups[i];
    if piece is null or piece !~ '^[0-9a-f]{1,4}$' then
      return 'unknown';
    end if;
    groups[i] := lpad(piece, 4, '0');
  end loop;
  return groups[1] || ':' || groups[2] || ':' || groups[3] || ':' || groups[4];
end;
$$;

create or replace function private.join_actor()
returns table (person_id uuid, company_id uuid, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.company_id, p.role
  from public.people p
  where p.auth_user_id = (select auth.uid());
$$;

create or replace function private.join_failure_count(
  p_bucket text,
  p_subject text,
  p_window interval
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.join_rate_limits r
  where r.bucket = p_bucket
    and r.subject = p_subject
    and r.kind = 'failure'
    and r.created_at > now() - p_window;
$$;

create or replace function private.record_join_failure(p_bucket text, p_subject text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject text;
  v_count integer;
begin
  if p_bucket in ('ip', 'login_ip', 'reset_ip', 'username_lookup') then
    v_subject := private.ip_subject(p_subject);
  else
    v_subject := left(coalesce(nullif(btrim(p_subject), ''), 'unknown'), 128);
  end if;

  insert into public.join_rate_limits (bucket, subject, kind)
  values (p_bucket, v_subject, 'failure');

  delete from public.join_rate_limits
  where created_at < now() - interval '1 day'
    and kind = 'failure';

  if p_bucket in ('global', 'login_global', 'reset_global') then
    v_count := private.join_failure_count(p_bucket, 'all', interval '10 minutes');
    if v_count = 100 then
      insert into public.join_rate_limits (bucket, subject, kind)
      values (p_bucket, 'all', 'alert');
      raise warning 'join_failure_burst';
    end if;
  end if;

  if p_bucket in ('ip', 'login_ip', 'reset_ip', 'username_lookup') then
    v_count := private.join_failure_count(p_bucket, v_subject, interval '15 minutes');
    if v_count = 40 then
      insert into public.join_rate_limits (bucket, subject, kind)
      values (p_bucket, v_subject, 'alert');
      raise warning 'join_ip_hot';
    end if;
  end if;
end;
$$;

create or replace function private.subject_limited(
  p_bucket text,
  p_subject text,
  p_window interval,
  p_limit integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.join_failure_count(p_bucket, left(coalesce(nullif(btrim(p_subject), ''), 'unknown'), 128), p_window) >= p_limit;
$$;

create or replace function private.record_ip_and_global(p_ip_bucket text, p_ip text, p_global_bucket text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_join_failure(p_ip_bucket, p_ip);
  perform private.record_join_failure(p_global_bucket, 'all');
end;
$$;

-- Known IPs hard-stop at 40 failures in 15 minutes. 'unknown' is never hard-stopped.
create or replace function private.ip_hard_limited(p_bucket text, p_ip text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subject text := private.ip_subject(coalesce(p_ip, ''));
begin
  if v_subject = 'unknown' then
    return false;
  end if;
  return private.join_failure_count(p_bucket, v_subject, interval '15 minutes') >= 40;
end;
$$;

-- A global burst adds a short progressive delay and an alert. It does not reject.
create or replace function private.global_step_up(p_bucket text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_delay integer;
begin
  v_count := private.join_failure_count(p_bucket, 'all', interval '10 minutes');
  if v_count < 100 then
    return 0;
  end if;
  v_delay := least(50, 10 * (v_count - 99));
  perform pg_catalog.pg_sleep(v_delay / 1000.0);
  return v_delay;
end;
$$;

create or replace function private.with_global_delay(p_bucket text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delay integer;
begin
  v_delay := private.global_step_up(p_bucket);
  if v_delay > 0 then
    return p_payload || jsonb_build_object('delay_ms', v_delay);
  end if;
  return p_payload;
end;
$$;

-- Real service check. PostgREST 12 puts the role in request.jwt.claims.
-- The legacy request.jwt.claim.role is used only when claims are absent.
-- An empty claim is not service_role.
create or replace function private.reject_unless_service()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_role text;
begin
  if v_claims is not null and btrim(v_claims) <> '' then
    begin
      v_role := nullif(btrim(v_claims::jsonb ->> 'role'), '');
    exception
      when others then
        v_role := null;
    end;
    if v_role is distinct from 'service_role' then
      raise exception 'not_authorized';
    end if;
    return;
  end if;

  v_role := nullif(current_setting('request.jwt.claim.role', true), '');
  if v_role is distinct from 'service_role' then
    raise exception 'not_authorized';
  end if;
end;
$$;

create or replace function private.clear_auth_sessions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return;
  end if;
  if to_regclass('auth.refresh_tokens') is not null then
    begin
      execute 'delete from auth.refresh_tokens where user_id::text = $1' using p_user_id::text;
    exception
      when undefined_column or undefined_table then
        null;
    end;
  end if;
  if to_regclass('auth.sessions') is not null then
    begin
      execute 'delete from auth.sessions where user_id = $1' using p_user_id;
    exception
      when undefined_column or undefined_table then
        null;
    end;
  end if;
end;
$$;

create or replace function private.ban_auth_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return;
  end if;
  perform private.clear_auth_sessions(p_user_id);
  if to_regclass('auth.users') is not null then
    begin
      execute 'update auth.users set banned_until = $1 where id = $2'
        using 'infinity'::timestamptz, p_user_id;
    exception
      when undefined_column or undefined_table then
        null;
    end;
  end if;
end;
$$;

revoke all on function private.normalize_join_code(text) from public, anon, authenticated;
revoke all on function private.ip_subject(text) from public, anon, authenticated;
revoke all on function private.join_actor() from public, anon, authenticated;
revoke all on function private.join_failure_count(text, text, interval) from public, anon, authenticated;
revoke all on function private.record_join_failure(text, text) from public, anon, authenticated;
revoke all on function private.subject_limited(text, text, interval, integer) from public, anon, authenticated;
revoke all on function private.record_ip_and_global(text, text, text) from public, anon, authenticated;
revoke all on function private.ipv4_subject(text) from public, anon, authenticated;
revoke all on function private.ip_hard_limited(text, text) from public, anon, authenticated;
revoke all on function private.global_step_up(text) from public, anon, authenticated;
revoke all on function private.with_global_delay(text, jsonb) from public, anon, authenticated;
revoke all on function private.reject_unless_service() from public, anon, authenticated;
revoke all on function private.clear_auth_sessions(uuid) from public, anon, authenticated;
revoke all on function private.ban_auth_user(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Create, revoke, cap. Authenticated owner or contracts manager.
-- ---------------------------------------------------------------------------

create or replace function public.create_join_code(
  p_site_id uuid,
  p_label text default null,
  p_max_uses integer default 10,
  p_hours integer default 24,
  p_code_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_company uuid;
  v_site_name text;
  v_archived timestamptz;
  v_company_name text;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_max integer := coalesce(p_max_uses, 10);
  v_hours integer := coalesce(p_hours, 24);
  v_hash bytea;
  v_id uuid;
  v_expires timestamptz;
begin
  select * into v_actor from private.join_actor();
  if not found or v_actor.role not in ('owner', 'cm') or v_actor.company_id is null then
    raise exception 'not_authorized';
  end if;

  select s.company_id, s.name, s.archived_at into v_company, v_site_name, v_archived
  from public.sites s
  where s.id = p_site_id;

  if v_company is null or v_company is distinct from v_actor.company_id or v_archived is not null then
    raise exception 'not_authorized';
  end if;

  if v_actor.role = 'cm' and not exists (
    select 1
    from public.site_assignments a
    where a.site_id = p_site_id
      and a.person_id = v_actor.person_id
  ) then
    raise exception 'not_authorized';
  end if;

  if v_label is not null and char_length(v_label) > 40 then
    raise exception 'label_too_long';
  end if;
  if v_max < 1 or v_max > 25 then
    raise exception 'cap_out_of_range';
  end if;
  if v_hours < 1 or v_hours > 168 then
    raise exception 'expiry_out_of_range';
  end if;

  begin
    v_hash := decode(p_code_hash, 'hex');
  exception
    when others then
      v_hash := null;
  end;
  if v_hash is null or octet_length(v_hash) <> 32 then
    raise exception 'invalid_input';
  end if;

  v_expires := now() + make_interval(hours => v_hours);

  begin
    insert into public.join_codes (
      company_id, site_id, code_hash, label, created_by, expires_at, max_uses
    )
    values (
      v_company, p_site_id, v_hash, v_label, v_actor.person_id, v_expires, v_max
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'code_in_use';
  end;

  select c.name into v_company_name from public.companies c where c.id = v_company;

  insert into public.join_audit (company_id, site_id, actor_id, action, detail)
  values (
    v_company,
    p_site_id,
    v_actor.person_id,
    'code_create',
    jsonb_build_object('code_id', v_id, 'max_uses', v_max, 'label', v_label, 'hours', v_hours)
  );

  return jsonb_build_object(
    'id', v_id,
    'expires_at', v_expires,
    'max_uses', v_max,
    'label', v_label,
    'site_id', p_site_id,
    'site_name', v_site_name,
    'company_name', v_company_name
  );
end;
$$;

create or replace function public.revoke_join_code(p_code_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_code public.join_codes;
begin
  select * into v_actor from private.join_actor();
  if not found or v_actor.role not in ('owner', 'cm') then
    raise exception 'not_authorized';
  end if;

  select * into v_code from public.join_codes where id = p_code_id;
  if not found or v_code.company_id is distinct from v_actor.company_id then
    raise exception 'not_authorized';
  end if;
  if v_actor.role = 'cm' and not private.can_access_site(v_code.site_id) then
    raise exception 'not_authorized';
  end if;

  if v_code.revoked_at is null then
    update public.join_codes set revoked_at = now() where id = v_code.id;
    insert into public.join_audit (company_id, site_id, actor_id, action, detail)
    values (
      v_code.company_id,
      v_code.site_id,
      v_actor.person_id,
      'code_revoke',
      jsonb_build_object('code_id', v_code.id, 'label', v_code.label)
    );
  end if;
end;
$$;

create or replace function public.set_join_code_cap(p_code_id uuid, p_max_uses integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_code public.join_codes;
begin
  select * into v_actor from private.join_actor();
  if not found or v_actor.role not in ('owner', 'cm') then
    raise exception 'not_authorized';
  end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 25 then
    raise exception 'cap_out_of_range';
  end if;

  select * into v_code from public.join_codes where id = p_code_id for update;
  if not found or v_code.company_id is distinct from v_actor.company_id then
    raise exception 'not_authorized';
  end if;
  if v_actor.role = 'cm' and not private.can_access_site(v_code.site_id) then
    raise exception 'not_authorized';
  end if;
  if p_max_uses < v_code.uses then
    raise exception 'cap_out_of_range';
  end if;
  if p_max_uses is distinct from v_code.max_uses then
    update public.join_codes set max_uses = p_max_uses where id = v_code.id;
    insert into public.join_audit (company_id, site_id, actor_id, action, detail)
    values (
      v_code.company_id,
      v_code.site_id,
      v_actor.person_id,
      'cap_change',
      jsonb_build_object('code_id', v_code.id, 'from', v_code.max_uses, 'to', p_max_uses)
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Join. Service role only. One transaction, row lock, scope from the code row.
-- Role is always operative. Company and site are never taken from the caller.
-- ---------------------------------------------------------------------------

create or replace function public.apply_join_code(
  p_code_hash text,
  p_auth_user_id uuid,
  p_display_name text,
  p_trade text,
  p_username text,
  p_client_ip text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_code public.join_codes;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_trade text := nullif(btrim(coalesce(p_trade, '')), '');
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_ip text := coalesce(p_client_ip, '');
  v_person uuid;
  v_dead boolean;
begin
  perform private.reject_unless_service();

  if private.ip_hard_limited('ip', v_ip) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  begin
    v_hash := decode(p_code_hash, 'hex');
  exception
    when others then
      v_hash := null;
  end;

  if v_hash is null or octet_length(v_hash) <> 32 or p_auth_user_id is null then
    perform private.record_ip_and_global('ip', v_ip, 'global');
    return private.with_global_delay('global', jsonb_build_object('ok', false, 'error', 'join_rejected'));
  end if;

  select * into v_code
  from public.join_codes
  where code_hash = v_hash
  for update;

  v_dead := not found
    or v_code.revoked_at is not null
    or v_code.expires_at <= now()
    or exists (
      select 1 from public.sites s
      where s.id = v_code.site_id
        and s.archived_at is not null
    );

  if v_dead then
    perform private.record_ip_and_global('ip', v_ip, 'global');
    return private.with_global_delay('global', jsonb_build_object('ok', false, 'error', 'join_rejected'));
  end if;

  if v_code.uses >= v_code.max_uses
     or v_name = '' or char_length(v_name) > 80
     or (v_trade is not null and char_length(v_trade) > 80)
     or v_username !~ '^[a-z0-9][a-z0-9._-]{2,23}$'
     or exists (select 1 from public.people p where lower(p.username) = v_username) then
    perform private.record_ip_and_global('ip', v_ip, 'global');
    insert into public.join_audit (company_id, site_id, actor_id, action, detail)
    values (
      v_code.company_id,
      v_code.site_id,
      null,
      'attempt',
      jsonb_build_object('code_id', v_code.id, 'reason', 'apply_failed')
    );
    return private.with_global_delay('global', jsonb_build_object('ok', false, 'error', 'join_rejected'));
  end if;

  begin
    insert into public.people (
      auth_user_id, company_id, role, trade, display_name, username
    )
    values (
      p_auth_user_id, v_code.company_id, 'operative', v_trade, v_name, v_username
    )
    returning id into v_person;
  exception
    when unique_violation then
      perform private.record_ip_and_global('ip', v_ip, 'global');
      insert into public.join_audit (company_id, site_id, actor_id, action, detail)
      values (
        v_code.company_id,
        v_code.site_id,
        null,
        'attempt',
        jsonb_build_object('code_id', v_code.id, 'reason', 'username_race')
      );
      return private.with_global_delay('global', jsonb_build_object('ok', false, 'error', 'join_rejected'));
  end;

  insert into public.site_assignments (site_id, person_id)
  values (v_code.site_id, v_person);

  insert into public.join_events (
    code_id, person_id, company_id, site_id, display_name, trade, username, auth_user_id
  )
  values (
    v_code.id, v_person, v_code.company_id, v_code.site_id, v_name, v_trade, v_username, p_auth_user_id
  );

  update public.join_codes
  set uses = uses + 1
  where id = v_code.id;

  insert into public.join_audit (company_id, site_id, actor_id, action, detail)
  values (
    v_code.company_id,
    v_code.site_id,
    v_person,
    'join',
    jsonb_build_object(
      'code_id', v_code.id,
      'label', v_code.label,
      'person_id', v_person,
      'user_agent', left(coalesce(p_user_agent, ''), 200)
    )
  );

  return private.with_global_delay(
    'global',
    jsonb_build_object(
      'ok', true,
      'person_id', v_person,
      'site_id', v_code.site_id,
      'company_id', v_code.company_id
    )
  );
end;
$$;

-- Cheap check before createUser. No row lock. Same payload for every dead code.
create or replace function public.preview_join_code(p_code_hash text, p_client_ip text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_code public.join_codes;
begin
  perform private.reject_unless_service();

  if private.ip_hard_limited('ip', coalesce(p_client_ip, '')) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  begin
    v_hash := decode(p_code_hash, 'hex');
  exception
    when others then
      v_hash := null;
  end;

  if v_hash is null or octet_length(v_hash) <> 32 then
    perform private.record_ip_and_global('ip', p_client_ip, 'global');
    return private.with_global_delay('global', jsonb_build_object('ok', false, 'error', 'join_rejected'));
  end if;

  select * into v_code from public.join_codes where code_hash = v_hash;
  if not found
     or v_code.revoked_at is not null
     or v_code.expires_at <= now()
     or v_code.uses >= v_code.max_uses
     or exists (
       select 1 from public.sites s
       where s.id = v_code.site_id and s.archived_at is not null
     ) then
    perform private.record_ip_and_global('ip', p_client_ip, 'global');
    return private.with_global_delay('global', jsonb_build_object('ok', false, 'error', 'join_rejected'));
  end if;

  return private.with_global_delay('global', jsonb_build_object('ok', true));
end;
$$;

-- Username lookup only after a live code. A dead code does not say whether the name is taken.
-- Lookups are throttled per known IP. Unknown is not hard-capped.
create or replace function public.username_is_taken(
  p_username text,
  p_code_hash text,
  p_client_ip text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_hash bytea;
  v_code public.join_codes;
  v_ip text := coalesce(p_client_ip, '');
begin
  perform private.reject_unless_service();

  if private.ip_hard_limited('ip', v_ip) or private.ip_hard_limited('username_lookup', v_ip) then
    return jsonb_build_object('ok', false, 'taken', false, 'error', 'rate_limited');
  end if;

  begin
    v_hash := decode(p_code_hash, 'hex');
  exception
    when others then
      v_hash := null;
  end;

  if v_hash is not null and octet_length(v_hash) = 32 then
    select * into v_code from public.join_codes where code_hash = v_hash;
  end if;

  if v_hash is null
     or octet_length(v_hash) <> 32
     or v_code.id is null
     or v_code.revoked_at is not null
     or v_code.expires_at <= now()
     or v_code.uses >= v_code.max_uses
     or exists (
       select 1 from public.sites s
       where s.id = v_code.site_id and s.archived_at is not null
     ) then
    perform private.record_ip_and_global('ip', v_ip, 'global');
    return private.with_global_delay(
      'global',
      jsonb_build_object('ok', false, 'taken', false, 'error', 'join_rejected')
    );
  end if;

  perform private.record_join_failure('username_lookup', v_ip);
  if v_username !~ '^[a-z0-9][a-z0-9._-]{2,23}$' then
    return jsonb_build_object('ok', true, 'taken', false);
  end if;
  return jsonb_build_object(
    'ok',
    true,
    'taken',
    exists (select 1 from public.people p where lower(p.username) = v_username)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Remove. The owner bans. A contracts manager only drops their own site,
-- and only for someone a contracts manager invited.
-- ---------------------------------------------------------------------------

create or replace function public.remove_joiner(
  p_person_id uuid,
  p_site_id uuid,
  p_revoke_code boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_person public.people;
  v_auth uuid;
  v_code uuid;
  v_creator_role text;
begin
  select * into v_actor from private.join_actor();
  if not found or v_actor.role not in ('owner', 'cm') then
    raise exception 'not_authorized';
  end if;

  select * into v_person from public.people where id = p_person_id;
  if not found
     or v_person.company_id is distinct from v_actor.company_id
     or v_person.role is distinct from 'operative' then
    raise exception 'not_authorized';
  end if;

  select e.code_id, creator.role into v_code, v_creator_role
  from public.join_events e
  join public.join_codes c on c.id = e.code_id
  left join public.people creator on creator.id = c.created_by
  where e.person_id = p_person_id
    and e.site_id = p_site_id
    and e.company_id = v_actor.company_id
    and e.removed_at is null
  order by e.joined_at desc
  limit 1;

  if v_actor.role = 'cm' then
    if not private.can_access_site(p_site_id) or v_code is null or v_creator_role is distinct from 'cm' then
      raise exception 'not_authorized';
    end if;

    update public.join_events
    set removed_at = now(),
        removed_by = v_actor.person_id
    where person_id = p_person_id
      and site_id = p_site_id
      and removed_at is null;

    delete from public.site_assignments
    where person_id = p_person_id
      and site_id = p_site_id;

    if coalesce(p_revoke_code, false) then
      update public.join_codes
      set revoked_at = coalesce(revoked_at, now())
      where id = v_code
        and revoked_at is null;
      insert into public.join_audit (company_id, site_id, actor_id, action, detail)
      values (
        v_actor.company_id,
        p_site_id,
        v_actor.person_id,
        'code_revoke',
        jsonb_build_object('code_id', v_code, 'via', 'remove_joiner')
      );
    end if;

    insert into public.join_audit (company_id, site_id, actor_id, action, detail)
    values (
      v_actor.company_id,
      p_site_id,
      v_actor.person_id,
      'remove',
      jsonb_build_object(
        'person_id', p_person_id,
        'scope', 'site',
        'revoked_code', coalesce(p_revoke_code, false),
        'code_id', v_code
      )
    );

    return jsonb_build_object('ok', true, 'person_id', p_person_id, 'scope', 'site');
  end if;

  if not exists (
    select 1
    from public.site_assignments a
    join public.sites s on s.id = a.site_id
    where a.person_id = p_person_id
      and a.site_id = p_site_id
      and s.company_id = v_actor.company_id
  ) and v_code is null then
    raise exception 'not_authorized';
  end if;

  update public.join_events
  set removed_at = coalesce(removed_at, now()),
      removed_by = v_actor.person_id
  where person_id = p_person_id
    and site_id = p_site_id
    and removed_at is null;

  if coalesce(p_revoke_code, false) and v_code is not null then
    update public.join_codes
    set revoked_at = coalesce(revoked_at, now())
    where id = v_code
      and revoked_at is null;
    insert into public.join_audit (company_id, site_id, actor_id, action, detail)
    values (
      v_actor.company_id,
      p_site_id,
      v_actor.person_id,
      'code_revoke',
      jsonb_build_object('code_id', v_code, 'via', 'remove_joiner')
    );
  end if;

  delete from public.site_assignments where person_id = p_person_id;

  v_auth := v_person.auth_user_id;

  begin
    delete from public.people where id = p_person_id;
  exception
    when foreign_key_violation then
      update public.people
      set auth_user_id = null,
          username = null
      where id = p_person_id;
  end;

  perform private.ban_auth_user(v_auth);

  insert into public.join_audit (company_id, site_id, actor_id, action, detail)
  values (
    v_actor.company_id,
    p_site_id,
    v_actor.person_id,
    'remove',
    jsonb_build_object(
      'person_id', p_person_id,
      'scope', 'company',
      'revoked_code', coalesce(p_revoke_code, false),
      'code_id', v_code
    )
  );

  return jsonb_build_object('ok', true, 'person_id', p_person_id, 'scope', 'company');
end;
$$;

-- ---------------------------------------------------------------------------
-- Password reset. Owner: any operative. CM: operatives on their sites.
-- Never an owner or contracts manager account.
-- ---------------------------------------------------------------------------

create or replace function public.reset_password_code(p_person_id uuid, p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_target public.people;
  v_hash bytea;
  v_id uuid;
  v_expires timestamptz := now() + interval '30 minutes';
begin
  select * into v_actor from private.join_actor();
  if not found or v_actor.role not in ('owner', 'cm') then
    raise exception 'not_authorized';
  end if;

  select * into v_target from public.people where id = p_person_id;
  if not found
     or v_target.company_id is distinct from v_actor.company_id
     or v_target.role is distinct from 'operative'
     or v_target.auth_user_id is null then
    perform private.record_join_failure('reset_issue', v_actor.person_id::text);
    raise exception 'not_authorized';
  end if;

  if v_actor.role = 'cm' and not exists (
    select 1
    from public.site_assignments mine
    join public.site_assignments theirs on theirs.site_id = mine.site_id
    where mine.person_id = v_actor.person_id
      and theirs.person_id = v_target.id
  ) then
    perform private.record_join_failure('reset_issue', v_actor.person_id::text);
    raise exception 'not_authorized';
  end if;

  begin
    v_hash := decode(p_code_hash, 'hex');
  exception
    when others then
      v_hash := null;
  end;
  if v_hash is null or octet_length(v_hash) <> 32 then
    raise exception 'invalid_input';
  end if;

  update public.password_reset_codes
  set revoked_at = now()
  where person_id = v_target.id
    and used_at is null
    and revoked_at is null;

  begin
    insert into public.password_reset_codes (
      person_id, company_id, code_hash, created_by, expires_at
    )
    values (v_target.id, v_target.company_id, v_hash, v_actor.person_id, v_expires)
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'code_in_use';
  end;

  insert into public.join_audit (company_id, site_id, actor_id, action, detail)
  values (
    v_target.company_id,
    null,
    v_actor.person_id,
    'reset_issue',
    jsonb_build_object('person_id', v_target.id, 'reset_id', v_id)
  );

  return jsonb_build_object(
    'expires_at', v_expires,
    'person_id', v_target.id,
    'reset_id', v_id
  );
end;
$$;

create or replace function public.redeem_password_reset(
  p_code_hash text,
  p_client_ip text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_row public.password_reset_codes;
  v_auth uuid;
  v_ip text := coalesce(p_client_ip, '');
  v_found boolean;
begin
  perform private.reject_unless_service();

  if private.ip_hard_limited('reset_ip', v_ip) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  begin
    v_hash := decode(p_code_hash, 'hex');
  exception
    when others then
      v_hash := null;
  end;

  if v_hash is null or octet_length(v_hash) <> 32 then
    perform private.record_ip_and_global('reset_ip', v_ip, 'reset_global');
    return private.with_global_delay('reset_global', jsonb_build_object('ok', false, 'error', 'reset_rejected'));
  end if;

  select * into v_row
  from public.password_reset_codes
  where code_hash = v_hash
  for update;
  v_found := found;

  if not v_found
     or v_row.used_at is not null
     or v_row.revoked_at is not null
     or v_row.expires_at <= now() then
    if v_found then
      perform private.record_join_failure('reset_target', v_row.person_id::text);
    end if;
    perform private.record_ip_and_global('reset_ip', v_ip, 'reset_global');
    return private.with_global_delay('reset_global', jsonb_build_object('ok', false, 'error', 'reset_rejected'));
  end if;

  if private.subject_limited('reset_target', v_row.person_id::text, interval '15 minutes', 10) then
    perform private.record_join_failure('reset_target', v_row.person_id::text);
    perform private.record_ip_and_global('reset_ip', v_ip, 'reset_global');
    return private.with_global_delay('reset_global', jsonb_build_object('ok', false, 'error', 'reset_rejected'));
  end if;

  select p.auth_user_id into v_auth
  from public.people p
  where p.id = v_row.person_id
    and p.role = 'operative';

  if v_auth is null then
    perform private.record_join_failure('reset_target', v_row.person_id::text);
    perform private.record_ip_and_global('reset_ip', v_ip, 'reset_global');
    return private.with_global_delay('reset_global', jsonb_build_object('ok', false, 'error', 'reset_rejected'));
  end if;

  update public.password_reset_codes
  set used_at = now()
  where id = v_row.id;

  update public.people
  set password_reset_at = now()
  where id = v_row.person_id;

  perform private.clear_auth_sessions(v_auth);

  insert into public.join_audit (company_id, site_id, actor_id, action, detail)
  values (
    v_row.company_id,
    null,
    v_row.person_id,
    'reset_redeem',
    jsonb_build_object('reset_id', v_row.id, 'person_id', v_row.person_id)
  );

  return private.with_global_delay(
    'reset_global',
    jsonb_build_object(
      'ok', true,
      'reset_id', v_row.id,
      'person_id', v_row.person_id,
      'auth_user_id', v_auth
    )
  );
end;
$$;

create or replace function public.release_password_reset(p_reset_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.password_reset_codes;
begin
  perform private.reject_unless_service();
  select * into v_row
  from public.password_reset_codes
  where id = p_reset_id
  for update;
  if not found or v_row.used_at is null or v_row.used_at < now() - interval '5 minutes' then
    return;
  end if;
  update public.password_reset_codes set used_at = null where id = v_row.id;
  update public.people set password_reset_at = null where id = v_row.person_id;
  insert into public.join_audit (company_id, site_id, actor_id, action, detail)
  values (
    v_row.company_id,
    null,
    v_row.person_id,
    'reset_release',
    jsonb_build_object('reset_id', v_row.id, 'person_id', v_row.person_id)
  );
end;
$$;

create or replace function public.lookup_username_login(
  p_username text,
  p_client_ip text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_auth uuid;
  v_ip text := coalesce(p_client_ip, '');
begin
  perform private.reject_unless_service();
  if v_username !~ '^[a-z0-9][a-z0-9._-]{2,23}$' then
    perform private.record_join_failure('login_user', left(coalesce(nullif(v_username, ''), 'bad'), 128));
    perform private.record_ip_and_global('login_ip', v_ip, 'login_global');
    return jsonb_build_object('ok', false, 'error', 'sign_in_failed');
  end if;

  if private.subject_limited('login_user', v_username, interval '15 minutes', 10) then
    perform private.record_join_failure('login_user', v_username);
    perform private.record_ip_and_global('login_ip', v_ip, 'login_global');
    return jsonb_build_object('ok', false, 'error', 'sign_in_failed');
  end if;

  select p.auth_user_id into v_auth
  from public.people p
  where lower(p.username) = v_username
    and p.auth_user_id is not null;

  if v_auth is null then
    perform private.record_join_failure('login_user', v_username);
    perform private.record_ip_and_global('login_ip', v_ip, 'login_global');
    return jsonb_build_object('ok', false, 'error', 'sign_in_failed');
  end if;

  return jsonb_build_object('ok', true, 'auth_user_id', v_auth);
end;
$$;

create or replace function public.note_login_failure(p_username text, p_client_ip text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
begin
  perform private.reject_unless_service();
  perform private.record_join_failure('login_user', left(coalesce(nullif(v_username, ''), 'bad'), 128));
  perform private.record_ip_and_global('login_ip', p_client_ip, 'login_global');
end;
$$;

create or replace function public.acknowledge_password_reset()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.people
  set password_reset_at = null
  where auth_user_id = (select auth.uid());
end;
$$;

revoke all on function public.create_join_code(uuid, text, integer, integer, text) from public, anon;
revoke all on function public.revoke_join_code(uuid) from public, anon;
revoke all on function public.set_join_code_cap(uuid, integer) from public, anon;
revoke all on function public.remove_joiner(uuid, uuid, boolean) from public, anon;
revoke all on function public.reset_password_code(uuid, text) from public, anon;
revoke all on function public.acknowledge_password_reset() from public, anon;

grant execute on function public.create_join_code(uuid, text, integer, integer, text) to authenticated;
grant execute on function public.revoke_join_code(uuid) to authenticated;
grant execute on function public.set_join_code_cap(uuid, integer) to authenticated;
grant execute on function public.remove_joiner(uuid, uuid, boolean) to authenticated;
grant execute on function public.reset_password_code(uuid, text) to authenticated;
grant execute on function public.acknowledge_password_reset() to authenticated;

revoke all on function public.apply_join_code(text, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.preview_join_code(text, text) from public, anon, authenticated;
revoke all on function public.username_is_taken(text, text, text) from public, anon, authenticated;
revoke all on function public.redeem_password_reset(text, text) from public, anon, authenticated;
revoke all on function public.release_password_reset(uuid) from public, anon, authenticated;
revoke all on function public.lookup_username_login(text, text) from public, anon, authenticated;
revoke all on function public.note_login_failure(text, text) from public, anon, authenticated;

grant execute on function public.apply_join_code(text, uuid, text, text, text, text, text) to service_role;
grant execute on function public.preview_join_code(text, text) to service_role;
grant execute on function public.username_is_taken(text, text, text) to service_role;
grant execute on function public.redeem_password_reset(text, text) to service_role;
grant execute on function public.release_password_reset(uuid) to service_role;
grant execute on function public.lookup_username_login(text, text) to service_role;
grant execute on function public.note_login_failure(text, text) to service_role;

comment on function public.create_join_code(uuid, text, integer, integer, text) is
  'Owner or CM stores a code hash for one active site. The edge function returns the plaintext. Default 24h and 10 uses. Max 7 days and 25 uses.';

comment on function public.revoke_join_code(uuid) is
  'Owner or CM of that site revokes a code.';

comment on function public.set_join_code_cap(uuid, integer) is
  'Owner or CM changes max uses. Hard max 25. Cannot drop below uses already counted.';

comment on function public.apply_join_code(text, uuid, text, text, text, text, text) is
  'Service role only. Locks the code row, checks cap, expiry, revoke, and an active site, then inserts an operative on that code''s company and site.';

comment on function public.preview_join_code(text, text) is
  'Service role only. Same accept or reject as apply, without creating a person and without a long lock.';

comment on function public.username_is_taken(text, text, text) is
  'Service role only. Answers after a live code. A dead code does not say if the name is taken. Throttled per known IP.';

comment on function public.remove_joiner(uuid, uuid, boolean) is
  'Owner: drop every assignment, detach or delete the person, clear sessions, and ban. CM: drop only that site, and only when a CM invited them.';

comment on function public.reset_password_code(uuid, text) is
  'Owner resets any operative. A CM resets operatives on their sites only. Never an owner or CM account. Stores the hash. 30 minutes, single use.';

comment on function public.redeem_password_reset(text, text) is
  'Service role only. Single use, 30 minutes. Hard limit per known IP and per person. Guessed hashes are not a key. A global burst delays. Clears sessions. Does not set the password.';

comment on function public.lookup_username_login(text, text) is
  'Service role only. Resolves a username to an auth user id. Limited per username. Does not return the placeholder email.';

-- ---------------------------------------------------------------------------
-- New-joiner badge on the site list. Seven days, not yet removed.
-- ---------------------------------------------------------------------------

create or replace function public.company_sites_pulse()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := private.my_role();
  v_company uuid := private.my_company_id();
  v_actor uuid := (
    select p.id from public.people p where p.auth_user_id = (select auth.uid())
  );
begin
  if v_role is null or v_role not in ('cm', 'owner') then
    raise exception 'not_authorized';
  end if;

  return coalesce(
    (
      select jsonb_agg(row_data order by row_data->>'name')
      from (
        select jsonb_build_object(
          'site_id', s.id,
          'name', s.name,
          'address_line', s.address_line,
          'assignee_count', (
            select count(*)::int from public.site_assignments a where a.site_id = s.id
          ),
          'assignee_names_preview', (
            select coalesce(jsonb_agg(sub.display_name), '[]'::jsonb)
            from (
              select coalesce(nullif(btrim(p.display_name), ''), 'Unknown') as display_name
              from public.site_assignments a
              join public.people p on p.id = a.person_id
              where a.site_id = s.id
              order by p.display_name nulls last
              limit 3
            ) sub
          ),
          'contracts_manager_names', (
            select coalesce(jsonb_agg(sub.display_name order by sub.display_name), '[]'::jsonb)
            from (
              select coalesce(nullif(btrim(p.display_name), ''), 'Unknown') as display_name
              from public.site_assignments a
              join public.people p on p.id = a.person_id
              where a.site_id = s.id
                and p.role = 'cm'
            ) sub
          ),
          'operative_count', (
            select count(*)::int
            from public.site_assignments a
            join public.people p on p.id = a.person_id
            where a.site_id = s.id
              and p.role = 'operative'
          ),
          'new_joiner_count', (
            select count(*)::int
            from public.join_events e
            where e.site_id = s.id
              and e.removed_at is null
              and e.joined_at > now() - interval '7 days'
          ),
          'archived_at', s.archived_at,
          'last_pack_update', s.updated_at,
          'open_request_count', (
            select count(*)::int
            from public.drawing_requests r
            where r.site_id = s.id
              and r.status = 'Open'
          )
        ) as row_data
        from public.sites s
        where s.company_id = v_company
          and (
            v_role = 'owner'
            or exists (
              select 1
              from public.site_assignments a
              where a.site_id = s.id
                and a.person_id = v_actor
            )
          )
        order by s.name
      ) q
    ),
    '[]'::jsonb
  );
end;
$$;

comment on function public.company_sites_pulse() is
  'Site list for the owner and contracts managers. Includes a 7-day new joiner count. Never email.';

revoke all on function public.company_sites_pulse() from public, anon;
grant execute on function public.company_sites_pulse() to authenticated;

-- ---------------------------------------------------------------------------
-- Labour list. Managers see usernames. Operatives do not call this.
-- ---------------------------------------------------------------------------

create or replace function public.company_people()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := private.my_role();
  v_company uuid := private.my_company_id();
  v_actor uuid := (
    select p.id from public.people p where p.auth_user_id = (select auth.uid())
  );
begin
  if v_role is null or v_role not in ('cm', 'owner') or v_company is null then
    raise exception 'not_authorized';
  end if;

  return coalesce(
    (
      select jsonb_agg(row_data order by row_data->>'display_name', row_data->>'id')
      from (
        select jsonb_build_object(
          'id', p.id,
          'display_name', p.display_name,
          'role', p.role,
          'trade', p.trade,
          'username', p.username,
          'has_login', p.auth_user_id is not null,
          'site_names', coalesce(
            (
              select jsonb_agg(s.name order by s.name)
              from public.site_assignments a
              join public.sites s on s.id = a.site_id
              where a.person_id = p.id
                and s.company_id = p.company_id
            ),
            '[]'::jsonb
          )
        ) as row_data
        from public.people p
        where p.company_id = v_company
          and (
            v_role = 'owner'
            or p.id = v_actor
            or private.shares_assigned_site(p.id)
          )
      ) q
    ),
    '[]'::jsonb
  );
end;
$$;

comment on function public.company_people() is
  'Labour list for the owner and contracts managers. Includes username. No email or phone.';

revoke all on function public.company_people() from public, anon;
grant execute on function public.company_people() to authenticated;

-- ---------------------------------------------------------------------------
-- Placeholder logins cannot move onto a real inbox.
-- ---------------------------------------------------------------------------

create or replace function private.block_placeholder_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email is not null
     and right(lower(old.email), char_length('@users.sitepack.invalid')) = '@users.sitepack.invalid'
     and new.email is distinct from old.email then
    raise exception 'email_change_blocked';
  end if;
  return new;
end;
$$;

revoke all on function private.block_placeholder_email_change() from public, anon, authenticated;

do $trig$
begin
  if to_regclass('auth.users') is not null then
    drop trigger if exists block_placeholder_email_change on auth.users;
    create trigger block_placeholder_email_change
      before update of email on auth.users
      for each row execute function private.block_placeholder_email_change();
  end if;
end
$trig$;
