-- Site sign-in and sign-out, plus the weekly hours sheet (6.4).
-- Hours only. This migration does not store money, statutory deductions, or storage keys.
-- Device time is kept. received_at is the server clock for that request.
-- Hours use the server time. A gap of more than 10 minutes is flagged.
-- An evening shift (signed in at or after 14:00 London, still inside 16 hours)
-- stays open until 06:00 London the next morning. Any other previous day closes
-- at 23:59, flagged not signed out. A later sign-out attaches only while that
-- shift is still one the grace could own.
-- Owner and contracts manager can correct an entry. The reason is required.
-- The audit keeps the before and after. Operatives receive a null audit.
-- On site now and the weekly sheet return null unless the caller is an owner or contracts manager.
-- Writes are SECURITY DEFINER with search_path pinned to empty.
-- Reads run as the caller, so RLS applies, after the forgotten-close function.
-- This migration does not alter storage, auth, or any Supabase-managed object.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.site_attendance (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  person_id uuid not null references public.people (id),
  person_name text not null,
  in_device_at timestamptz not null,
  in_received_at timestamptz not null,
  in_at timestamptz not null,
  in_gap boolean not null,
  out_device_at timestamptz,
  out_received_at timestamptz,
  out_at timestamptz,
  out_gap boolean,
  forgot_sign_out boolean not null default false,
  late_out_device_at timestamptz,
  late_out_received_at timestamptz,
  late_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_attendance_name_len check (char_length(btrim(person_name)) between 1 and 120),
  constraint site_attendance_out_order check (out_at is null or out_at >= in_at),
  constraint site_attendance_out_pair check (
    (out_at is null and out_received_at is null and out_gap is null and forgot_sign_out = false)
    or (out_at is not null and out_received_at is not null and out_gap is not null)
  ),
  constraint site_attendance_late_pair check (
    (late_out_at is null and late_out_device_at is null and late_out_received_at is null)
    or (
      forgot_sign_out
      and late_out_at is not null
      and late_out_device_at is not null
      and late_out_received_at is not null
    )
  )
);

create unique index site_attendance_one_open
  on public.site_attendance (person_id)
  where out_at is null;

create index site_attendance_site_open_idx
  on public.site_attendance (site_id)
  where out_at is null;

create index site_attendance_person_in_idx
  on public.site_attendance (person_id, in_at desc);

comment on table public.site_attendance is
  'One sign-in and optional sign-out. in_at and out_at are the server times used for hours.';

comment on column public.site_attendance.in_device_at is
  'When the phone said the person signed in.';

comment on column public.site_attendance.in_received_at is
  'Server clock when sign_in_site ran. Not supplied by the client.';

comment on column public.site_attendance.in_at is
  'Time used for hours. Starts as in_received_at. A correction may replace it.';

comment on column public.site_attendance.in_gap is
  'True when the phone and the server disagree by more than 10 minutes.';

comment on column public.site_attendance.forgot_sign_out is
  'True when the row was closed at 23:59 Europe/London because nobody signed out.';

comment on column public.site_attendance.late_out_at is
  'Server time of a sign-out that arrived after the 23:59 close. Hours stay on out_at until a manager corrects them.';

create table public.site_attendance_audit (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.site_attendance (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  corrected_by uuid not null references public.people (id),
  corrected_by_name text not null,
  reason text not null,
  before_entry jsonb not null,
  after_entry jsonb not null,
  created_at timestamptz not null default now(),
  constraint site_attendance_audit_reason_len check (char_length(btrim(reason)) between 1 and 500),
  constraint site_attendance_audit_name_len check (char_length(btrim(corrected_by_name)) between 1 and 120)
);

create index site_attendance_audit_entry_idx
  on public.site_attendance_audit (entry_id, created_at);

comment on table public.site_attendance_audit is
  'A correction. before_entry and after_entry are the hours fields. Operatives cannot read this table.';

-- ---------------------------------------------------------------------------
-- Actor, device time, London day. search_path is empty.
-- ---------------------------------------------------------------------------

create or replace function private.attendance_actor()
returns table (person_id uuid, company_id uuid, role text, display_name text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.id, p.company_id, p.role, p.display_name
  from public.people p
  where p.auth_user_id = (select auth.uid());
$fn$;

revoke all on function private.attendance_actor() from public, anon, authenticated;

create or replace function private.attendance_person_label(p_name text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select left(coalesce(nullif(btrim(coalesce(p_name, '')), ''), 'Someone on site'), 120);
$fn$;

revoke all on function private.attendance_person_label(text) from public, anon, authenticated;

-- The API roles cannot move this clock. The owner session can pin it for the local probe.
create or replace function private.attendance_now()
returns timestamptz
language sql
stable
set search_path = ''
as $fn$
  select case
    when session_user = current_user then coalesce(
      nullif(pg_catalog.current_setting('sitepack.attendance_now', true), '')::timestamptz,
      pg_catalog.now()
    )
    else pg_catalog.now()
  end;
$fn$;

revoke all on function private.attendance_now() from public, anon, authenticated;

create or replace function private.attendance_device_time(p_at timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_now timestamptz;
begin
  v_now := private.attendance_now();
  if p_at is null
     or p_at > v_now + interval '24 hours'
     or p_at < v_now - interval '30 days' then
    raise exception 'invalid_time';
  end if;
  return p_at;
end;
$fn$;

revoke all on function private.attendance_device_time(timestamptz) from public, anon, authenticated;

create or replace function private.attendance_gap(p_device timestamptz, p_received timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select abs(extract(epoch from (p_device - p_received))) > 600;
$fn$;

revoke all on function private.attendance_gap(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function private.london_day(p_at timestamptz)
returns date
language sql
immutable
set search_path = ''
as $fn$
  select (timezone('Europe/London', p_at))::date;
$fn$;

revoke all on function private.london_day(timestamptz) from public, anon, authenticated;

create or replace function private.london_start(p_day date)
returns timestamptz
language sql
immutable
set search_path = ''
as $fn$
  select timezone('Europe/London', p_day + time '00:00');
$fn$;

revoke all on function private.london_start(date) from public, anon, authenticated;

create or replace function private.london_end(p_day date)
returns timestamptz
language sql
immutable
set search_path = ''
as $fn$
  select timezone('Europe/London', p_day + time '23:59');
$fn$;

revoke all on function private.london_end(date) from public, anon, authenticated;

create or replace function private.attendance_require_site(p_site_id uuid)
returns table (person_id uuid, company_id uuid, role text, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_person uuid;
  v_company uuid;
  v_role text;
  v_name text;
  v_site_company uuid;
begin
  select a.person_id, a.company_id, a.role, a.display_name
  into v_person, v_company, v_role, v_name
  from private.attendance_actor() a;

  if v_person is null or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  select s.company_id into v_site_company
  from public.sites s
  where s.id = p_site_id;

  if v_site_company is null or v_site_company <> v_company then
    raise exception 'not_authorized';
  end if;

  person_id := v_person;
  company_id := v_company;
  role := v_role;
  display_name := v_name;
  return next;
end;
$fn$;

revoke all on function private.attendance_require_site(uuid) from public, anon, authenticated;

-- A shift the overnight rule can still own: signed in at or after 14:00
-- Europe/London and still inside the 16 hour hold. 16 is (24 - 14) + 6,
-- so a 14:00 sign-in reaches exactly 06:00 on a 24 hour day.
-- On the October clock-change night the civil day is 25 hours. A 14:00–15:00
-- BST sign-in loses the hold at 05:00 GMT, because the 16 hour limit runs out
-- before 06:00. That is intended: the hold is absolute time, not civil time.
create or replace function private.attendance_overnight(p_in timestamptz, p_now timestamptz)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $fn$
  select p_in is not null
    and p_now is not null
    and (timezone('Europe/London', p_in))::time >= time '14:00'
    and p_now >= p_in
    and p_now < p_in + interval '16 hours';
$fn$;

revoke all on function private.attendance_overnight(timestamptz, timestamptz) from public, anon, authenticated;

-- Idempotent. A previous London day closes at 23:59 of its start day unless
-- the shift is still inside the overnight grace (evening start, 16h hold, before 06:00).
create or replace function private.close_forgotten_attendance()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_company uuid;
  v_count integer;
  v_now timestamptz;
begin
  select a.company_id into v_company from private.attendance_actor() a;
  if v_company is null then
    raise exception 'not_authorized';
  end if;

  v_now := private.attendance_now();

  update public.site_attendance entry
  set out_at = greatest(private.london_end(private.london_day(entry.in_at)), entry.in_at),
      out_received_at = v_now,
      out_gap = false,
      forgot_sign_out = true,
      updated_at = v_now
  where entry.company_id = v_company
    and entry.out_at is null
    and private.london_day(entry.in_at) < private.london_day(v_now)
    and not (
      private.attendance_overnight(entry.in_at, v_now)
      and v_now < timezone(
        'Europe/London',
        (private.london_day(entry.in_at) + 1) + time '06:00'
      )
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke all on function private.close_forgotten_attendance() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS. Operative: own rows on own sites. Owner and CM: their company sites.
-- Audit is owner and CM only. No client insert, update, or delete.
-- ---------------------------------------------------------------------------

alter table public.site_attendance enable row level security;
alter table public.site_attendance_audit enable row level security;

revoke all on table public.site_attendance from public, anon, authenticated;
revoke all on table public.site_attendance_audit from public, anon, authenticated;

grant select on table public.site_attendance to authenticated;
grant select on table public.site_attendance_audit to authenticated;

create policy site_attendance_select
  on public.site_attendance for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.can_access_site(site_id)
    and (
      person_id = (select p.id from public.people p where p.auth_user_id = (select auth.uid()))
      or private.my_role() in ('owner', 'cm')
    )
  );

create policy site_attendance_audit_select
  on public.site_attendance_audit for select to authenticated
  using (
    company_id = private.my_company_id()
    and private.can_access_site(site_id)
    and private.my_role() in ('owner', 'cm')
  );

-- ---------------------------------------------------------------------------
-- JSON. Audit is null unless the caller is an owner or contracts manager.
-- ---------------------------------------------------------------------------

create or replace function private.attendance_audit_json(p_entry_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_rows jsonb;
begin
  if coalesce(private.my_role(), '') not in ('owner', 'cm') then
    return null;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'reason', a.reason,
      'corrected_by_name', a.corrected_by_name,
      'before_entry', a.before_entry,
      'after_entry', a.after_entry,
      'created_at', a.created_at
    )
    order by a.created_at
  ), '[]'::jsonb)
  into v_rows
  from public.site_attendance_audit a
  where a.entry_id = p_entry_id;

  return v_rows;
end;
$fn$;

revoke all on function private.attendance_audit_json(uuid) from public, anon;

create or replace function private.attendance_json(p_entry_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  select jsonb_build_object(
    'entry_id', e.id,
    'site_id', e.site_id,
    'person_id', e.person_id,
    'person_name', e.person_name,
    'in_device_at', e.in_device_at,
    'in_received_at', e.in_received_at,
    'in_at', e.in_at,
    'in_gap', e.in_gap,
    'out_device_at', e.out_device_at,
    'out_received_at', e.out_received_at,
    'out_at', e.out_at,
    'out_gap', e.out_gap,
    'forgot_sign_out', e.forgot_sign_out,
    'late_sign_out', e.late_out_at is not null,
    'late_out_device_at', e.late_out_device_at,
    'late_out_received_at', e.late_out_received_at,
    'late_out_at', e.late_out_at,
    'state', case when e.out_at is null then 'in' else 'out' end,
    'audit', private.attendance_audit_json(e.id)
  )
  from public.site_attendance e
  where e.id = p_entry_id;
$fn$;

revoke all on function private.attendance_json(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

create or replace function public.close_forgotten_attendance()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  return private.close_forgotten_attendance();
end;
$fn$;

create or replace function public.sign_in_site(p_site_id uuid, p_device_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_device timestamptz;
  v_received timestamptz;
  v_id uuid;
  v_open_name text;
begin
  select * into v_actor from private.attendance_require_site(p_site_id);
  v_received := private.attendance_now();
  v_device := private.attendance_device_time(p_device_at);
  perform private.close_forgotten_attendance();

  select s.name into v_open_name
  from public.site_attendance a
  join public.sites s on s.id = a.site_id
  where a.person_id = v_actor.person_id
    and a.out_at is null
  limit 1;

  if v_open_name is not null then
    raise exception 'already_signed_in' using detail = v_open_name;
  end if;

  v_id := gen_random_uuid();
  insert into public.site_attendance (
    id, site_id, company_id, person_id, person_name,
    in_device_at, in_received_at, in_at, in_gap
  ) values (
    v_id, p_site_id, v_actor.company_id, v_actor.person_id,
    private.attendance_person_label(v_actor.display_name),
    v_device, v_received, v_received, private.attendance_gap(v_device, v_received)
  );

  return private.attendance_json(v_id);
end;
$fn$;

create or replace function public.sign_out_site(p_site_id uuid, p_device_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_device timestamptz;
  v_received timestamptz;
  v_row public.site_attendance;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_actor from private.attendance_require_site(p_site_id);
  v_received := private.attendance_now();
  v_device := private.attendance_device_time(p_device_at);
  perform private.close_forgotten_attendance();

  select a.* into v_row
  from public.site_attendance a
  where a.person_id = v_actor.person_id
    and a.site_id = p_site_id
    and a.out_at is null;

  if v_row.id is not null then
    update public.site_attendance
    set out_device_at = v_device,
        out_received_at = v_received,
        out_at = v_received,
        out_gap = private.attendance_gap(v_device, v_received),
        updated_at = v_received
    where id = v_row.id;

    return private.attendance_json(v_row.id);
  end if;

  -- Already closed at 23:59. Attach only when this shift is still one the grace
  -- could own, and no later shift exists for this person on this site.
  select a.* into v_row
  from public.site_attendance a
  where a.person_id = v_actor.person_id
    and a.site_id = p_site_id
    and a.forgot_sign_out
    and private.attendance_overnight(a.in_at, v_received)
    and not exists (
      select 1
      from public.site_attendance later
      where later.person_id = a.person_id
        and later.site_id = a.site_id
        and later.in_at > a.in_at
    )
  order by a.in_at desc
  limit 1;

  if v_row.id is null or v_row.late_out_at is not null then
    raise exception 'not_signed_in';
  end if;

  v_before := jsonb_build_object(
    'in_at', v_row.in_at,
    'out_at', v_row.out_at,
    'in_device_at', v_row.in_device_at,
    'in_received_at', v_row.in_received_at,
    'out_device_at', v_row.out_device_at,
    'out_received_at', v_row.out_received_at,
    'forgot_sign_out', v_row.forgot_sign_out,
    'in_gap', v_row.in_gap,
    'out_gap', v_row.out_gap,
    'late_out_at', v_row.late_out_at,
    'late_out_device_at', v_row.late_out_device_at,
    'late_out_received_at', v_row.late_out_received_at
  );

  update public.site_attendance
  set late_out_device_at = v_device,
      late_out_received_at = v_received,
      late_out_at = v_received,
      updated_at = v_received
  where id = v_row.id;

  v_after := v_before || jsonb_build_object(
    'late_out_at', v_received,
    'late_out_device_at', v_device,
    'late_out_received_at', v_received
  );

  insert into public.site_attendance_audit (
    entry_id, site_id, company_id, corrected_by, corrected_by_name, reason, before_entry, after_entry
  ) values (
    v_row.id, v_row.site_id, v_row.company_id, v_actor.person_id,
    private.attendance_person_label(v_actor.display_name),
    'Late sign-out sent from the phone',
    v_before,
    v_after
  );

  return private.attendance_json(v_row.id);
end;
$fn$;

create or replace function public.correct_attendance(
  p_entry_id uuid,
  p_in_at timestamptz,
  p_out_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.site_attendance;
  v_overlap public.site_attendance;
  v_actor record;
  v_reason text;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_row from public.site_attendance where id = p_entry_id;
  if v_row.id is null then
    raise exception 'not_authorized';
  end if;

  select * into v_actor from private.attendance_require_site(v_row.site_id);
  if v_actor.role not in ('owner', 'cm') or v_row.company_id <> v_actor.company_id then
    raise exception 'not_authorized';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 500
     or p_in_at is null or p_out_at is null or p_out_at < p_in_at then
    raise exception 'invalid_input';
  end if;

  if p_in_at < private.attendance_now() - interval '2 years'
     or p_out_at > private.attendance_now() + interval '24 hours' then
    raise exception 'invalid_time';
  end if;

  select other.* into v_overlap
  from public.site_attendance other
  where other.person_id = v_row.person_id
    and other.id <> v_row.id
    and other.in_at < p_out_at
    and (other.out_at is null or other.out_at > p_in_at)
  order by other.in_at
  limit 1;

  if v_overlap.id is not null then
    raise exception 'correction_overlaps'
      using detail =
        to_char(timezone('Europe/London', v_overlap.in_at), 'YYYY-MM-DD HH24:MI')
        || ' – '
        || case
             when v_overlap.out_at is null then 'still signed in'
             else to_char(timezone('Europe/London', v_overlap.out_at), 'YYYY-MM-DD HH24:MI')
           end;
  end if;

  v_before := jsonb_build_object(
    'in_at', v_row.in_at,
    'out_at', v_row.out_at,
    'in_device_at', v_row.in_device_at,
    'in_received_at', v_row.in_received_at,
    'out_device_at', v_row.out_device_at,
    'out_received_at', v_row.out_received_at,
    'forgot_sign_out', v_row.forgot_sign_out,
    'in_gap', v_row.in_gap,
    'out_gap', v_row.out_gap,
    'late_out_at', v_row.late_out_at,
    'late_out_device_at', v_row.late_out_device_at,
    'late_out_received_at', v_row.late_out_received_at
  );

  update public.site_attendance
  set in_at = p_in_at,
      out_at = p_out_at,
      out_received_at = coalesce(out_received_at, pg_catalog.now()),
      out_gap = coalesce(out_gap, false),
      updated_at = pg_catalog.now()
  where id = v_row.id;

  v_after := jsonb_build_object(
    'in_at', p_in_at,
    'out_at', p_out_at,
    'in_device_at', v_row.in_device_at,
    'in_received_at', v_row.in_received_at,
    'out_device_at', v_row.out_device_at,
    'out_received_at', coalesce(v_row.out_received_at, pg_catalog.now()),
    'forgot_sign_out', v_row.forgot_sign_out,
    'in_gap', v_row.in_gap,
    'out_gap', coalesce(v_row.out_gap, false),
    'late_out_at', v_row.late_out_at,
    'late_out_device_at', v_row.late_out_device_at,
    'late_out_received_at', v_row.late_out_received_at
  );

  insert into public.site_attendance_audit (
    entry_id, site_id, company_id, corrected_by, corrected_by_name, reason, before_entry, after_entry
  ) values (
    v_row.id, v_row.site_id, v_row.company_id, v_actor.person_id,
    private.attendance_person_label(v_actor.display_name), v_reason, v_before, v_after
  );

  return private.attendance_json(v_row.id);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Reads. Invoker, so RLS hides other sites, other firms, and other people.
-- Manager lists return null for an operative.
-- ---------------------------------------------------------------------------

create or replace function public.my_site_attendance(p_site_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_entry jsonb;
begin
  if p_site_id is null or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  perform public.close_forgotten_attendance();

  select e.id into v_id
  from public.site_attendance e
  where e.site_id = p_site_id
    and e.out_at is null
    and e.person_id = (select p.id from public.people p where p.auth_user_id = (select auth.uid()));

  if v_id is null then
    return jsonb_build_object('state', 'out', 'entry', null);
  end if;

  v_entry := private.attendance_json(v_id);
  return jsonb_build_object('state', 'in', 'entry', v_entry);
end;
$fn$;

create or replace function public.list_my_attendance(p_site_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_rows jsonb;
begin
  if p_site_id is null or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  perform public.close_forgotten_attendance();

  select coalesce(jsonb_agg(private.attendance_json(e.id) order by e.in_at desc), '[]'::jsonb)
  into v_rows
  from public.site_attendance e
  where e.site_id = p_site_id
    and e.person_id = (select p.id from public.people p where p.auth_user_id = (select auth.uid()));

  return v_rows;
end;
$fn$;

create or replace function public.list_on_site_now(p_site_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_rows jsonb;
begin
  if p_site_id is null or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  if coalesce(private.my_role(), '') not in ('owner', 'cm') then
    return null;
  end if;

  perform public.close_forgotten_attendance();

  select coalesce(jsonb_agg(item order by in_at), '[]'::jsonb)
  into v_rows
  from (
    select
      e.in_at,
      jsonb_build_object(
        'entry_id', e.id,
        'person_id', e.person_id,
        'person_name', e.person_name,
        'in_at', e.in_at,
        'in_device_at', e.in_device_at,
        'in_received_at', e.in_received_at,
        'in_gap', e.in_gap
      ) as item
    from public.site_attendance e
    where e.site_id = p_site_id
      and e.out_at is null
  ) listed;

  return jsonb_build_object('rows', v_rows);
end;
$fn$;

create or replace function public.weekly_attendance(p_site_id uuid, p_week_start date)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_rows jsonb;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_site_id is null or not private.can_access_site(p_site_id) then
    raise exception 'not_authorized';
  end if;

  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'invalid_input';
  end if;

  if coalesce(private.my_role(), '') not in ('owner', 'cm') then
    return null;
  end if;

  perform public.close_forgotten_attendance();

  v_start := timezone('Europe/London', p_week_start + time '00:00');
  v_end := timezone('Europe/London', (p_week_start + 7) + time '00:00');

  select coalesce(jsonb_agg(private.attendance_json(e.id) order by e.person_name, e.in_at), '[]'::jsonb)
  into v_rows
  from public.site_attendance e
  where e.site_id = p_site_id
    and e.in_at < v_end
    and coalesce(e.out_at, pg_catalog.now()) > v_start;

  return jsonb_build_object('week_start', p_week_start, 'entries', v_rows);
end;
$fn$;

create or replace function public.attendance_entry(p_entry_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_site uuid;
  v_row jsonb;
begin
  select e.site_id into v_site
  from public.site_attendance e
  where e.id = p_entry_id;

  if v_site is null or not private.can_access_site(v_site) then
    raise exception 'not_authorized';
  end if;

  perform public.close_forgotten_attendance();

  v_row := private.attendance_json(p_entry_id);
  if v_row is null then
    raise exception 'not_authorized';
  end if;
  return v_row;
end;
$fn$;

revoke all on function public.close_forgotten_attendance() from public, anon;
revoke all on function public.sign_in_site(uuid, timestamptz) from public, anon;
revoke all on function public.sign_out_site(uuid, timestamptz) from public, anon;
revoke all on function public.correct_attendance(uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.my_site_attendance(uuid) from public, anon;
revoke all on function public.list_my_attendance(uuid) from public, anon;
revoke all on function public.list_on_site_now(uuid) from public, anon;
revoke all on function public.weekly_attendance(uuid, date) from public, anon;
revoke all on function public.attendance_entry(uuid) from public, anon;

grant execute on function public.close_forgotten_attendance() to authenticated;
grant execute on function public.sign_in_site(uuid, timestamptz) to authenticated;
grant execute on function public.sign_out_site(uuid, timestamptz) to authenticated;
grant execute on function public.correct_attendance(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.my_site_attendance(uuid) to authenticated;
grant execute on function public.list_my_attendance(uuid) to authenticated;
grant execute on function public.list_on_site_now(uuid) to authenticated;
grant execute on function public.weekly_attendance(uuid, date) to authenticated;
grant execute on function public.attendance_entry(uuid) to authenticated;

grant execute on function private.attendance_json(uuid) to authenticated;
grant execute on function private.attendance_audit_json(uuid) to authenticated;
