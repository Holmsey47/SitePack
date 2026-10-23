-- Attendance RLS. Apply scripts/throwaway-auth.sql and every migration first.
--   DATABASE_URL=postgres://postgres@127.0.0.1/sitepack_hours bash scripts/run-attendance-rls.sh
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

create temp table probe (k text primary key, v jsonb);
grant all on table probe to authenticated;

select pg_temp.ok(
  private.london_end(date '2026-03-29') = timestamptz '2026-03-29 22:59:00+00'
  and private.london_end(date '2026-10-25') = timestamptz '2026-10-25 23:59:00+00'
  and private.london_start(date '2026-03-29') = timestamptz '2026-03-29 00:00:00+00'
  and private.london_start(date '2026-10-25') = timestamptz '2026-10-24 23:00:00+00'
  and private.london_start(date '2026-03-30') - private.london_start(date '2026-03-29') = interval '23 hours'
  and private.london_start(date '2026-10-26') - private.london_start(date '2026-10-25') = interval '25 hours',
  '23:59 Europe/London is right on both clock-change Sundays'
);

insert into probe (k, v)
values (
  'monday',
  to_jsonb((date_trunc('week', private.london_day(pg_catalog.now())::timestamp))::date)
);

select pg_temp.ok(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'sign_in_site',
        'sign_out_site',
        'close_forgotten_attendance',
        'correct_attendance',
        'my_site_attendance',
        'list_my_attendance',
        'list_on_site_now',
        'weekly_attendance',
        'attendance_entry'
      )
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
        where c like 'search_path=%'
      )
  ) = 9,
  'attendance functions pin search_path'
);

select pg_temp.ok(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname in (
        'sign_in_site',
        'sign_out_site',
        'close_forgotten_attendance',
        'correct_attendance'
      )
  ) = 4
  and not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'my_site_attendance',
        'list_my_attendance',
        'list_on_site_now',
        'weekly_attendance',
        'attendance_entry'
      )
      and p.prosecdef
  ),
  'writes are security definer and attendance reads run as the caller'
);

select pg_temp.ok(
  not has_function_privilege('anon', 'public.sign_in_site(uuid,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.sign_out_site(uuid,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.correct_attendance(uuid,timestamptz,timestamptz,text)', 'execute')
  and not has_function_privilege('anon', 'public.close_forgotten_attendance()', 'execute')
  and not has_function_privilege('anon', 'public.my_site_attendance(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.list_my_attendance(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.list_on_site_now(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.weekly_attendance(uuid,date)', 'execute')
  and not has_function_privilege('anon', 'public.attendance_entry(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.attendance_actor()', 'execute')
  and not has_function_privilege('anon', 'private.attendance_person_label(text)', 'execute')
  and not has_function_privilege('anon', 'private.attendance_now()', 'execute')
  and not has_function_privilege('anon', 'private.attendance_device_time(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'private.attendance_gap(timestamptz,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'private.london_day(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'private.london_start(date)', 'execute')
  and not has_function_privilege('anon', 'private.london_end(date)', 'execute')
  and not has_function_privilege('anon', 'private.attendance_require_site(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.close_forgotten_attendance()', 'execute')
  and not has_function_privilege('anon', 'private.attendance_overnight(timestamptz,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'private.attendance_audit_json(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.attendance_json(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.reject_control_display_name()', 'execute')
  and not has_function_privilege('public', 'public.sign_in_site(uuid,timestamptz)', 'execute')
  and not has_table_privilege('anon', 'public.site_attendance', 'select')
  and not has_table_privilege('anon', 'public.site_attendance_audit', 'select')
  and not has_table_privilege('authenticated', 'public.site_attendance', 'insert')
  and not has_table_privilege('authenticated', 'public.site_attendance', 'update')
  and not has_table_privilege('authenticated', 'public.site_attendance_audit', 'insert'),
  'anon cannot call attendance and clients cannot write the tables directly'
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

insert into public.people (id, auth_user_id, company_id, role, display_name, email, trade)
values
  (:'ownerx', :'ownerx', :'firmx', 'owner', 'Owner X', 'ownerx@firmx.test', null),
  (:'cmx', :'cmx', :'firmx', 'cm', 'CM X', 'cmx@firmx.test', 'contracts'),
  (:'opa', :'opa', :'firmx', 'operative', 'Op A', 'opa@firmx.test', 'dryliner'),
  (:'opb', :'opb', :'firmx', 'operative', 'Op B', 'opb@firmx.test', 'labourer'),
  (:'opc', :'opc', :'firmx', 'operative', 'Op C', 'opc@firmx.test', 'carpenter'),
  (:'ownery', :'ownery', :'firmy', 'owner', 'Owner Y', 'ownery@firmy.test', null);

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

select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_in_site(' || quote_literal(:'siteb') || '::uuid, now())',
    'not_authorized'
  ),
  'operative of site A cannot sign in on site B'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_in_site(' || quote_literal(:'sitea') || '::uuid, now() - interval ''40 days'')',
    'invalid_time'
  ),
  'a device time older than 30 days is rejected'
);

insert into probe (k, v)
values (
  'a-in',
  public.sign_in_site(:'sitea'::uuid, now() - interval '11 minutes')
);

select pg_temp.ok(
  (select (v->>'in_gap')::boolean
      and v->>'in_at' = v->>'in_received_at'
      and v->>'in_at' is distinct from v->>'in_device_at'
      and v->>'state' = 'in'
      and v->'audit' = 'null'::jsonb
   from probe where k = 'a-in'),
  'the server time is used and a gap over 10 minutes is flagged'
);

select pg_temp.ok(
  (select in_at = in_received_at and in_gap from public.site_attendance where person_id = :'opa'::uuid),
  'the stored row uses the server time'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_in_site(' || quote_literal(:'sitea') || '::uuid, now())',
    'already_signed_in'
  ),
  'a second sign-in is refused'
);

do $open_site$
declare
  v_message text;
  v_detail text;
  v_hint text;
begin
  begin
    perform public.sign_in_site('51111111-1111-4111-8111-111111111111'::uuid, pg_catalog.now());
    raise exception 'FAIL: second sign-in succeeded';
  exception
    when others then
      if sqlerrm = 'FAIL: second sign-in succeeded' then
        raise;
      end if;
      get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
      if v_message <> 'already_signed_in' or v_detail <> 'Site A' or v_hint <> '51111111-1111-4111-8111-111111111111' then
        raise exception 'FAIL: already_signed_in named % / % / %', v_message, v_detail, v_hint;
      end if;
  end;
end
$open_site$;

select pg_temp.ok(
  public.list_on_site_now(:'sitea'::uuid) is null
  and public.weekly_attendance(
    :'sitea'::uuid,
    (select (v #>> '{}')::date from probe where k = 'monday')
  ) is null,
  'on site now and the weekly sheet are null for an operative'
);

insert into probe (k, v)
values (
  'a-out',
  public.sign_out_site(:'sitea'::uuid, now() - interval '2 minutes')
);

select pg_temp.ok(
  (select not (v->>'out_gap')::boolean
      and v->>'out_at' = v->>'out_received_at'
      and v->>'state' = 'out'
      and v->'audit' = 'null'::jsonb
   from probe where k = 'a-out'),
  'sign-out uses the server time and a short gap is not flagged'
);

select pg_temp.ok(
  pg_temp.raises(
    'update public.site_attendance set person_name = ''nope''',
    'permission denied for table site_attendance'
  ),
  'an operative cannot edit entries'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.correct_attendance('
      || quote_literal((select v->>'entry_id' from probe where k = 'a-out'))
      || '::uuid, now() - interval ''2 hours'', now() - interval ''1 hour'', ''Because'')',
    'not_authorized'
  ),
  'an operative cannot correct an entry'
);

reset role;
select pg_temp.jwt(:'opc'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.site_attendance) = 0
  and (select count(*) from public.site_attendance_audit) = 0
  and public.list_my_attendance(:'sitea'::uuid) = '[]'::jsonb,
  'an operative cannot read another person''s hours'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.attendance_entry('
      || quote_literal((select v->>'entry_id' from probe where k = 'a-out'))
      || '::uuid)',
    'not_authorized'
  ),
  'an operative cannot open another person''s entry'
);

reset role;
select pg_temp.jwt(:'opb'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.site_attendance) = 0,
  'operative of site B cannot read site A'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.my_site_attendance(' || quote_literal(:'sitea') || '::uuid)',
    'not_authorized'
  ),
  'operative of site B cannot ask for site A'
);

reset role;
select pg_temp.jwt(:'cmx'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.list_on_site_now(' || quote_literal(:'siteb') || '::uuid)',
    'not_authorized'
  ),
  'contracts manager cannot read a site they are not on'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.site_attendance) = 1
  and (select company_id from public.site_attendance) = :'firmx'::uuid
  and jsonb_array_length(public.list_on_site_now(:'sitea'::uuid)->'rows') = 0,
  'firm X cannot read firm Y and an empty site is an empty list'
);

-- Two days ago, 08:00–16:00 London. now() minus a few hours starts after
-- yesterday 22:00 once the clock is past 06:00, and the late sign-out probe
-- then sees a later shift.
insert into probe (k, v)
values (
  'corrected',
  public.correct_attendance(
    (select (v->>'entry_id')::uuid from probe where k = 'a-out'),
    timezone('Europe/London', (private.london_day(pg_catalog.now()) - 2) + time '08:00'),
    timezone('Europe/London', (private.london_day(pg_catalog.now()) - 2) + time '16:00'),
    'Left at four, not when the phone synced'
  )
);

select pg_temp.ok(
  (select v->'audit'->0->>'reason' = 'Left at four, not when the phone synced'
      and (v->'audit'->0->'before_entry'->>'in_at') is distinct from (v->'audit'->0->'after_entry'->>'in_at')
      and (v->'audit'->0->'before_entry'->>'out_at') is distinct from (v->'audit'->0->'after_entry'->>'out_at')
      and (v->'audit'->0->'before_entry'->>'in_device_at') = (v->'audit'->0->'after_entry'->>'in_device_at')
      and v->>'in_at' = v->'audit'->0->'after_entry'->>'in_at'
   from probe where k = 'corrected'),
  'a correction keeps the before and after and the device time'
);

select pg_temp.ok(
  (select count(*) = 1 and bool_and(reason = 'Left at four, not when the phone synced')
   from public.site_attendance_audit),
  'the audit row is stored'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.correct_attendance('
      || quote_literal((select v->>'entry_id' from probe where k = 'a-out'))
      || '::uuid, now() - interval ''2 hours'', now(), '' '')',
    'invalid_input'
  ),
  'a correction without a reason is refused'
);

select pg_temp.ok(
  public.weekly_attendance(
    :'sitea'::uuid,
    (select (v #>> '{}')::date from probe where k = 'monday')
  ) is not null,
  'the owner receives the weekly sheet'
);

reset role;
select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  (public.attendance_entry((select (v->>'entry_id')::uuid from probe where k = 'a-out'))->'audit') = 'null'::jsonb
  and (select count(*) from public.site_attendance_audit) = 0,
  'an operative''s entry hides the correction log'
);

reset role;
select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;

insert into probe (k, v)
values ('y', public.sign_in_site(:'sitey'::uuid, now()));

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.site_attendance where company_id = :'firmy'::uuid) = 0
  and (select count(*) from public.site_attendance) = 1,
  'firm X cannot read firm Y hours'
);

reset role;
select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.site_attendance) = 1
  and (select company_id from public.site_attendance) = :'firmy'::uuid,
  'firm Y cannot read firm X hours'
);

reset role;

insert into probe (k, v)
values
  ('night-in', to_jsonb(timezone('Europe/London', (private.london_day(pg_catalog.now()) - 2) + time '22:00'))),
  ('night-two', to_jsonb(timezone('Europe/London', (private.london_day(pg_catalog.now()) - 1) + time '02:00'))),
  ('late-in', to_jsonb(timezone('Europe/London', (private.london_day(pg_catalog.now()) - 1) + time '22:00'))),
  ('late-seven', to_jsonb(timezone('Europe/London', private.london_day(pg_catalog.now()) + time '07:00'))),
  ('day-in', to_jsonb(timezone('Europe/London', (private.london_day(pg_catalog.now()) - 1) + time '07:00'))),
  ('day-early', to_jsonb(timezone('Europe/London', private.london_day(pg_catalog.now()) + time '05:30'))),
  ('old-in', to_jsonb(timezone('Europe/London', (private.london_day(pg_catalog.now()) - 3) + time '22:00')));

select set_config('sitepack.attendance_now', (select v #>> '{}' from probe where k = 'night-two'), true);

insert into public.site_attendance (
  id, site_id, company_id, person_id, person_name,
  in_device_at, in_received_at, in_at, in_gap
) values (
  '61111111-1111-4111-8111-111111111201',
  :'sitea'::uuid,
  :'firmx'::uuid,
  :'opa'::uuid,
  'Operative A',
  (select (v #>> '{}')::timestamptz from probe where k = 'night-in'),
  (select (v #>> '{}')::timestamptz from probe where k = 'night-in'),
  (select (v #>> '{}')::timestamptz from probe where k = 'night-in'),
  false
);

select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

insert into probe (k, v)
values (
  'two',
  public.sign_out_site(
    :'sitea'::uuid,
    (select (v #>> '{}')::timestamptz from probe where k = 'night-two')
  )
);

reset role;

select pg_temp.ok(
  (
    select out_at = (select (p.v #>> '{}')::timestamptz from probe p where p.k = 'night-two')
      and not forgot_sign_out
      and late_out_at is null
    from public.site_attendance
    where id = '61111111-1111-4111-8111-111111111201'
  ),
  'a 22:00 sign-in signed out at 02:00 closes at 02:00'
);

select set_config('sitepack.attendance_now', (select v #>> '{}' from probe where k = 'late-seven'), true);

insert into public.site_attendance (
  id, site_id, company_id, person_id, person_name,
  in_device_at, in_received_at, in_at, in_gap
) values (
  '61111111-1111-4111-8111-111111111202',
  :'sitea'::uuid,
  :'firmx'::uuid,
  :'opa'::uuid,
  'Operative A',
  (select (v #>> '{}')::timestamptz from probe where k = 'late-in'),
  (select (v #>> '{}')::timestamptz from probe where k = 'late-in'),
  (select (v #>> '{}')::timestamptz from probe where k = 'late-in'),
  false
);

select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select public.close_forgotten_attendance();

insert into probe (k, v)
values (
  'seven',
  public.sign_out_site(
    :'sitea'::uuid,
    (select (v #>> '{}')::timestamptz from probe where k = 'late-seven')
  )
);

select public.close_forgotten_attendance();
select public.close_forgotten_attendance();

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_out_site('
      || quote_literal(:'sitea')
      || '::uuid, '
      || quote_literal((select v #>> '{}' from probe where k = 'late-seven'))
      || '::timestamptz)',
    'not_signed_in'
  ),
  'a second late sign-out is refused'
);

reset role;

insert into public.site_attendance (
  id, site_id, company_id, person_id, person_name,
  in_device_at, in_received_at, in_at, in_gap,
  out_device_at, out_received_at, out_at, out_gap, forgot_sign_out
) values (
  '61111111-1111-4111-8111-111111111203',
  :'sitea'::uuid,
  :'firmx'::uuid,
  :'opa'::uuid,
  'Operative A',
  (select (v #>> '{}')::timestamptz from probe where k = 'old-in'),
  (select (v #>> '{}')::timestamptz from probe where k = 'old-in'),
  (select (v #>> '{}')::timestamptz from probe where k = 'old-in'),
  false,
  (select (v #>> '{}')::timestamptz from probe where k = 'old-in'),
  (select (v #>> '{}')::timestamptz from probe where k = 'old-in'),
  private.london_end(private.london_day((select (v #>> '{}')::timestamptz from probe where k = 'old-in'))),
  false,
  true
);

select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_out_site('
      || quote_literal(:'sitea')
      || '::uuid, '
      || quote_literal((select v #>> '{}' from probe where k = 'late-seven'))
      || '::timestamptz)',
    'not_signed_in'
  ),
  'a sign-out days later does not attach to an older forgotten shift'
);

reset role;

select pg_temp.ok(
  (
    select forgot_sign_out
      and late_out_at = (select (p.v #>> '{}')::timestamptz from probe p where p.k = 'late-seven')
      and late_out_device_at = late_out_at
      and late_out_received_at = late_out_at
      and out_at = private.london_end(private.london_day(in_at))
      and (select (q.v->>'late_sign_out')::boolean from probe q where q.k = 'seven')
    from public.site_attendance
    where id = '61111111-1111-4111-8111-111111111202'
  ),
  'a sign-out at 07:00 the next day is stored as a late sign-out'
);

select pg_temp.ok(
  (
    select count(*)
    from public.site_attendance_audit
    where entry_id = '61111111-1111-4111-8111-111111111202'
      and reason = 'Late sign-out sent from the phone'
  ) = 1
  and (
    select count(*)
    from public.site_attendance
    where id = '61111111-1111-4111-8111-111111111202'
      and forgot_sign_out
      and out_at = private.london_end(private.london_day(in_at))
  ) = 1,
  'closing forgotten rows again does not add a second close'
);

select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (public.attendance_entry('61111111-1111-4111-8111-111111111202') -> 'audit' -> 0 ->> 'reason')
    = 'Late sign-out sent from the phone',
  'a manager can see the late sign-out'
);

reset role;

select pg_temp.ok(
  (
    select late_out_at is null
    from public.site_attendance
    where id = '61111111-1111-4111-8111-111111111203'
  ),
  'an older forgotten shift keeps no late sign-out'
);

select set_config('sitepack.attendance_now', (select v #>> '{}' from probe where k = 'day-early'), true);

insert into public.site_attendance (
  id, site_id, company_id, person_id, person_name,
  in_device_at, in_received_at, in_at, in_gap
) values (
  '61111111-1111-4111-8111-111111111204',
  :'sitea'::uuid,
  :'firmx'::uuid,
  :'opa'::uuid,
  'Operative A',
  (select (v #>> '{}')::timestamptz from probe where k = 'day-in'),
  (select (v #>> '{}')::timestamptz from probe where k = 'day-in'),
  (select (v #>> '{}')::timestamptz from probe where k = 'day-in'),
  false
);

select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

insert into probe (k, v)
values (
  'day-next',
  public.sign_in_site(
    :'sitea'::uuid,
    (select (v #>> '{}')::timestamptz from probe where k = 'day-early')
  )
);

reset role;

select pg_temp.ok(
  (
    select forgot_sign_out
      and out_at = private.london_end(private.london_day(in_at))
      and late_out_at is null
    from public.site_attendance
    where id = '61111111-1111-4111-8111-111111111204'
  )
  and (select (v->>'state') = 'in' from probe where k = 'day-next'),
  'a day shift forgotten overnight is closed at 05:30 and the next sign-in works'
);

insert into public.site_attendance (
  id, site_id, company_id, person_id, person_name,
  in_device_at, in_received_at, in_at, in_gap
) values (
  '61111111-1111-4111-8111-111111111205',
  :'siteb'::uuid,
  :'firmx'::uuid,
  :'opb'::uuid,
  'Operative B',
  (select (v #>> '{}')::timestamptz from probe where k = 'late-in'),
  (select (v #>> '{}')::timestamptz from probe where k = 'late-in'),
  (select (v #>> '{}')::timestamptz from probe where k = 'late-in'),
  false
);

select pg_temp.jwt(:'opb'::uuid);
set local role authenticated;

do $held$
declare
  v_message text;
  v_detail text;
  v_hint text;
begin
  begin
    perform public.sign_in_site(
      '51111111-1111-4111-8111-111111111112'::uuid,
      (select (v #>> '{}')::timestamptz from probe where k = 'day-early')
    );
    raise exception 'FAIL: evening shift was not held';
  exception
    when others then
      if sqlerrm = 'FAIL: evening shift was not held' then
        raise;
      end if;
      get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
      if v_message <> 'already_signed_in' or v_detail <> 'Site B' or v_hint <> '51111111-1111-4111-8111-111111111112' then
        raise exception 'FAIL: held shift named % / % / %', v_message, v_detail, v_hint;
      end if;
  end;
end
$held$;

reset role;

select pg_temp.ok(
  (
    select out_at is null and not forgot_sign_out
    from public.site_attendance
    where id = '61111111-1111-4111-8111-111111111205'
  ),
  'a 22:00 shift is still open at 05:30'
);

reset role;

insert into probe (k, v)
values
  ('dup-night', to_jsonb(timezone('Europe/London', (private.london_day(pg_catalog.now()) - 1) + time '22:00'))),
  ('dup-six', to_jsonb(timezone('Europe/London', private.london_day(pg_catalog.now()) + time '06:00'))),
  ('dup-seven', to_jsonb(timezone('Europe/London', private.london_day(pg_catalog.now()) + time '07:00'))),
  ('dup-eight', to_jsonb(timezone('Europe/London', private.london_day(pg_catalog.now()) + time '08:00'))),
  ('dup-tap', to_jsonb(timezone('Europe/London', private.london_day(pg_catalog.now()) + time '08:05')));

select set_config('sitepack.attendance_now', (select v #>> '{}' from probe where k = 'dup-six'), true);

insert into public.site_attendance (
  id, site_id, company_id, person_id, person_name,
  in_device_at, in_received_at, in_at, in_gap
) values (
  '61111111-1111-4111-8111-111111111208',
  :'sitea'::uuid,
  :'firmx'::uuid,
  :'opc'::uuid,
  'Op C',
  (select (v #>> '{}')::timestamptz from probe where k = 'dup-night'),
  (select (v #>> '{}')::timestamptz from probe where k = 'dup-night'),
  (select (v #>> '{}')::timestamptz from probe where k = 'dup-night'),
  false
);

select pg_temp.jwt(:'opc'::uuid);
set local role authenticated;

select public.close_forgotten_attendance();

select set_config('sitepack.attendance_now', (select v #>> '{}' from probe where k = 'dup-seven'), true);

insert into probe (k, v)
values (
  'dup-day',
  public.sign_in_site(
    :'sitea'::uuid,
    (select (v #>> '{}')::timestamptz from probe where k = 'dup-seven')
  )
);

select set_config('sitepack.attendance_now', (select v #>> '{}' from probe where k = 'dup-eight'), true);

select public.sign_out_site(
  :'sitea'::uuid,
  (select (v #>> '{}')::timestamptz from probe where k = 'dup-eight')
);

select set_config('sitepack.attendance_now', (select v #>> '{}' from probe where k = 'dup-tap'), true);

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_out_site('
      || quote_literal(:'sitea')
      || '::uuid, '
      || quote_literal((select v #>> '{}' from probe where k = 'dup-tap'))
      || '::timestamptz)',
    'not_signed_in'
  ),
  'a duplicate sign-out after a later shift is refused'
);

reset role;

select pg_temp.ok(
  (
    select forgot_sign_out and late_out_at is null
    from public.site_attendance
    where id = '61111111-1111-4111-8111-111111111208'
  )
  and (
    select out_at = (select (p.v #>> '{}')::timestamptz from probe p where p.k = 'dup-eight')
      and late_out_at is null
      and not forgot_sign_out
    from public.site_attendance
    where id = (select (v->>'entry_id')::uuid from probe where k = 'dup-day')
  ),
  'a duplicate tap at 08:05 does not become the night shift late sign-out'
);

select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

do $overlap$
declare
  v_message text;
  v_detail text;
  v_expected text;
  v_day uuid;
begin
  select (v->>'entry_id')::uuid into v_day from probe where k = 'dup-day';
  select to_char(timezone('Europe/London', in_at), 'YYYY-MM-DD HH24:MI')
    || ' – '
    || to_char(timezone('Europe/London', out_at), 'YYYY-MM-DD HH24:MI')
  into v_expected
  from public.site_attendance
  where id = '61111111-1111-4111-8111-111111111208';
  begin
    perform public.correct_attendance(
      v_day,
      (select (v #>> '{}')::timestamptz from probe where k = 'dup-night'),
      (select (v #>> '{}')::timestamptz from probe where k = 'dup-eight'),
      'Stretched over the night shift'
    );
    raise exception 'FAIL: overlap was saved';
  exception
    when others then
      if sqlerrm = 'FAIL: overlap was saved' then
        raise;
      end if;
      get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail;
      if v_message <> 'correction_overlaps' or v_detail is distinct from v_expected then
        raise exception 'FAIL: overlap % / % expected %', v_message, v_detail, v_expected;
      end if;
  end;
end
$overlap$;

reset role;

select pg_temp.ok(
  (
    select out_at = (select (p.v #>> '{}')::timestamptz from probe p where p.k = 'dup-eight')
    from public.site_attendance
    where id = (select (v->>'entry_id')::uuid from probe where k = 'dup-day')
  ),
  'an overlapping correction is refused and the shift is unchanged'
);

select pg_temp.ok(
  pg_temp.raises(
    'update public.people set display_name = ''Bad'' || chr(10) || ''Name'' where id = ''a1111111-1111-4111-8111-111111111115''',
    'invalid_display_name'
  )
  and pg_temp.raises(
    'update public.people set display_name = ''Bad'' || chr(127) where id = ''a1111111-1111-4111-8111-111111111115''',
    'invalid_display_name'
  )
  and pg_temp.raises(
    'update public.people set display_name = chr(1) || ''Bad'' where id = ''a1111111-1111-4111-8111-111111111115''',
    'invalid_display_name'
  ),
  'a display name with a control character is invalid_display_name'
);

update public.people
set display_name = 'Op ' || chr(128)
where id = 'a1111111-1111-4111-8111-111111111115';

select pg_temp.ok(
  (select display_name = 'Op ' || chr(128) from public.people where id = 'a1111111-1111-4111-8111-111111111115'),
  'a display name may include a character above U+007F'
);

update public.people
set display_name = 'Op C'
where id = 'a1111111-1111-4111-8111-111111111115';

insert into public.site_attendance (
  id, site_id, company_id, person_id, person_name,
  in_device_at, in_received_at, in_at, in_gap,
  out_device_at, out_received_at, out_at, out_gap, forgot_sign_out
) values (
  '61111111-1111-4111-8111-111111111209',
  '51111111-1111-4111-8111-111111111112',
  'c1111111-1111-4111-8111-111111111111',
  'a1111111-1111-4111-8111-111111111114',
  'Op B',
  timestamptz '2026-10-19 08:00:00+00',
  timestamptz '2026-10-19 08:00:00+00',
  timestamptz '2026-10-19 08:00:00+00',
  false,
  timestamptz '2026-10-19 09:00:00+00',
  timestamptz '2026-10-19 09:00:00+00',
  timestamptz '2026-10-19 09:00:00+00',
  false,
  false
);

select set_config('sitepack.attendance_now', '2026-10-19 18:00:00+00', true);
select pg_temp.jwt('a1111111-1111-4111-8111-111111111111'::uuid);
set local role authenticated;

select public.correct_attendance(
  '61111111-1111-4111-8111-111111111209'::uuid,
  timestamptz '2026-10-19 08:00:00+00',
  timestamptz '2026-10-20 08:00:00+00',
  'Exactly one day'
);

select pg_temp.ok(
  (
    select out_at = timestamptz '2026-10-20 08:00:00+00'
    from public.site_attendance
    where id = '61111111-1111-4111-8111-111111111209'
  ),
  'a shift of exactly 24 hours is kept'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.correct_attendance(''61111111-1111-4111-8111-111111111209''::uuid, timestamptz ''2026-10-19 08:00:00+00'', timestamptz ''2026-10-20 08:01:00+00'', ''One minute over'')',
    'shift_too_long'
  ),
  'a correction longer than 24 hours is shift_too_long'
);

select pg_temp.ok(
  (
    select out_at = timestamptz '2026-10-20 08:00:00+00'
    from public.site_attendance
    where id = '61111111-1111-4111-8111-111111111209'
  ),
  'a too-long correction leaves the shift unchanged'
);

select public.correct_attendance(
  '61111111-1111-4111-8111-111111111209'::uuid,
  timestamptz '2026-10-19 08:00:00+00',
  timestamptz '2026-10-20 08:00:00+00',
  'Left' || chr(10) || 'at four'
);

select pg_temp.ok(
  (
    select exists (
      select 1
      from public.site_attendance_audit
      where entry_id = '61111111-1111-4111-8111-111111111209'
        and reason = 'Leftat four'
    )
    and not exists (
      select 1
      from public.site_attendance_audit
      where entry_id = '61111111-1111-4111-8111-111111111209'
        and position(chr(10) in reason) > 0
    )
  ),
  'a correction reason drops control characters'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.correct_attendance(''61111111-1111-4111-8111-111111111209''::uuid, timestamptz ''2026-10-19 08:00:00+00'', timestamptz ''2026-10-20 08:00:00+00'', chr(10))',
    'invalid_input'
  ),
  'a reason of only a control character is invalid_input'
);

reset role;

-- Same London day on the 25-hour clock change, so the forgotten-close does not
-- take the row first. 00:00 BST to 23:59 GMT is longer than 24 hours.
insert into public.site_attendance (
  id, site_id, company_id, person_id, person_name,
  in_device_at, in_received_at, in_at, in_gap
) values (
  '61111111-1111-4111-8111-111111111210',
  '51111111-1111-4111-8111-111111111112',
  'c1111111-1111-4111-8111-111111111111',
  'a1111111-1111-4111-8111-111111111114',
  'Op B',
  timestamptz '2026-10-24 23:00:00+00',
  timestamptz '2026-10-24 23:00:00+00',
  timestamptz '2026-10-24 23:00:00+00',
  false
);

select set_config('sitepack.attendance_now', '2026-10-25 23:59:00+00', true);
select pg_temp.jwt('a1111111-1111-4111-8111-111111111114'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_out_site(''51111111-1111-4111-8111-111111111112''::uuid, timestamptz ''2026-10-25 23:59:00+00'')',
    'shift_too_long'
  ),
  'a sign-out longer than 24 hours is shift_too_long'
);

select pg_temp.ok(
  (select out_at is null from public.site_attendance where id = '61111111-1111-4111-8111-111111111210'),
  'a too-long sign-out leaves the shift open'
);

reset role;
select set_config('sitepack.attendance_now', '2026-10-25 23:00:00+00', true);
select pg_temp.jwt('a1111111-1111-4111-8111-111111111114'::uuid);
set local role authenticated;

select public.sign_out_site(
  '51111111-1111-4111-8111-111111111112'::uuid,
  timestamptz '2026-10-25 23:00:00+00'
);

select pg_temp.ok(
  (
    select out_at = timestamptz '2026-10-25 23:00:00+00'
    from public.site_attendance
    where id = '61111111-1111-4111-8111-111111111210'
  ),
  'a sign-out of exactly 24 hours is kept'
);

reset role;

select set_config('sitepack.attendance_now', '', true);
set local role anon;

do $anon$
declare
  call text;
  calls text[] := array[
    'public.sign_in_site(''51111111-1111-4111-8111-111111111111''::uuid, now())',
    'public.sign_out_site(''51111111-1111-4111-8111-111111111111''::uuid, now())',
    'public.correct_attendance(''51111111-1111-4111-8111-111111111111''::uuid, now(), now(), ''no'')',
    'public.close_forgotten_attendance()',
    'public.my_site_attendance(''51111111-1111-4111-8111-111111111111''::uuid)',
    'public.list_my_attendance(''51111111-1111-4111-8111-111111111111''::uuid)',
    'public.list_on_site_now(''51111111-1111-4111-8111-111111111111''::uuid)',
    'public.weekly_attendance(''51111111-1111-4111-8111-111111111111''::uuid, date ''2026-10-19'')',
    'public.attendance_entry(''51111111-1111-4111-8111-111111111111''::uuid)',
    'private.attendance_actor()',
    'private.attendance_person_label(''Ada'')',
    'private.attendance_now()',
    'private.attendance_device_time(now())',
    'private.attendance_gap(now(), now())',
    'private.london_day(now())',
    'private.london_start(date ''2026-10-19'')',
    'private.london_end(date ''2026-10-19'')',
    'private.attendance_require_site(''51111111-1111-4111-8111-111111111111''::uuid)',
    'private.close_forgotten_attendance()',
    'private.attendance_overnight(now(), now())',
    'private.attendance_audit_json(''51111111-1111-4111-8111-111111111111''::uuid)',
    'private.attendance_json(''51111111-1111-4111-8111-111111111111''::uuid)',
    'private.reject_control_display_name()'
  ];
begin
  if array_length(calls, 1) <> 23 then
    raise exception 'FAIL: anon probe list drifted';
  end if;
  foreach call in array calls loop
    begin
      execute 'select ' || call;
      raise exception 'FAIL: anon called %', call;
    exception
      when insufficient_privilege then
        null;
    end;
  end loop;
  raise notice 'ok: anon cannot call the 9 public and 14 private attendance functions';
end
$anon$;

reset role;

rollback;
