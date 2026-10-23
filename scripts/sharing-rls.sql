-- Main-contractor sharing RLS.
-- Apply scripts/throwaway-auth.sql and every migration first.
--   DATABASE_URL=postgres://postgres@127.0.0.1/sitepack_share bash scripts/run-sharing-rls.sh
-- The checks roll back. Nothing here is a hosted project.

\set ON_ERROR_STOP on
\set firmx 'c1111111-1111-4111-8111-111111111111'
\set firmy 'c2222222-2222-4222-8222-222222222222'
\set firmz 'c3333333-3333-4333-8333-333333333333'
\set ownerx 'a1111111-1111-4111-8111-111111111111'
\set cmx 'a1111111-1111-4111-8111-111111111112'
\set opx 'a1111111-1111-4111-8111-111111111113'
\set ownery 'a2222222-2222-4222-8222-222222222221'
\set ownerz 'a3333333-3333-4333-8333-333333333331'
\set sitea '51111111-1111-4111-8111-111111111111'
\set siteb '51111111-1111-4111-8111-111111111112'
\set hashok 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
\set hashexp 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
\set hashused 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
\set hashother 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
\set hashrev 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
\set hashop 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
\set hashlook 'abababababababababababababababababababababababababababababababab'
\set hashspace 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'
\set cmy 'a2222222-2222-4222-8222-222222222222'
\set opy 'a2222222-2222-4222-8222-222222222223'

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

do $catalog$
declare
  r record;
  v_in integer;
  v_args text;
  v_sql text;
  v_state text;
  v_count integer;
  v_expected integer;
  v_replaced integer;
begin
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and not exists (
      select 1
      from public.proc_catalog_before b
      where b.nspname = n.nspname
        and b.proname = p.proname
        and b.args = pg_get_function_identity_arguments(p.oid)
    );
  select count(*) into v_expected from public.share_funcs_expected where not replaced;
  select count(*) into v_replaced from public.share_funcs_expected where replaced;
  if v_expected <> 24 or v_replaced <> 2 then
    raise exception 'FAIL: migration list expected 24 new and 2 replaced, found % / %', v_expected, v_replaced;
  end if;
  if v_count <> 24 then
    raise exception 'FAIL: expected 24 new functions, found %', v_count;
  end if;
  if exists (
    select 1
    from public.share_funcs_expected e
    where not e.replaced
      and not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = e.nspname
          and p.proname = e.proname
          and not exists (
            select 1
            from public.proc_catalog_before b
            where b.nspname = n.nspname
              and b.proname = p.proname
              and b.args = pg_get_function_identity_arguments(p.oid)
          )
      )
  ) then
    raise exception 'FAIL: a function from this migration is missing';
  end if;
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not exists (
        select 1
        from public.proc_catalog_before b
        where b.nspname = n.nspname
          and b.proname = p.proname
          and b.args = pg_get_function_identity_arguments(p.oid)
      )
      and not exists (
        select 1
        from public.share_funcs_expected e
        where e.nspname = n.nspname
          and e.proname = p.proname
          and not e.replaced
      )
  ) then
    raise exception 'FAIL: a new function is not in this migration';
  end if;
  raise notice 'functions created: %', v_count;

  for r in
    select n.nspname, p.proname, p.pronargs, p.proargmodes, p.oid, p.prosecdef, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join public.share_funcs_expected e on e.nspname = n.nspname and e.proname = p.proname
  loop
    if not r.prosecdef
      or not exists (
        select 1 from unnest(coalesce(r.proconfig, array[]::text[])) c
        where c in ('search_path=', 'search_path=""')
      )
      or has_function_privilege('anon', r.oid, 'execute')
      or has_function_privilege('public', r.oid, 'execute')
    then
      raise exception 'FAIL: catalog % definer % anon % public % config %',
        r.nspname || '.' || r.proname, r.prosecdef,
        has_function_privilege('anon', r.oid, 'execute'),
        has_function_privilege('public', r.oid, 'execute'),
        r.proconfig;
    end if;

    if r.nspname <> 'public' then
      continue;
    end if;
    if r.proargmodes is null then
      v_in := r.pronargs;
    else
      select count(*) into v_in from unnest(r.proargmodes) m where m in ('i', 'b', 'v');
    end if;
    select coalesce(string_agg('null', ', '), '') into v_args from generate_series(1, v_in);
    v_sql := format('select %I.%I(%s)', r.nspname, r.proname, v_args);
    begin
      execute 'set local role anon';
      execute v_sql;
      raise exception 'FAIL: anon call ran %', r.proname;
    exception
      when insufficient_privilege then
        null;
      when others then
        get stacked diagnostics v_state = returned_sqlstate;
        if v_state is distinct from '42501' then
          raise exception 'FAIL: anon call % as % %', r.proname, v_state, sqlerrm;
        end if;
    end;
  end loop;
end
$catalog$;

reset role;

select pg_temp.ok(
  private.share_company_key('  Firm   Y ') = 'Firm Y'
  and private.share_company_key('  FIRM   y ') = 'FIRM y'
  and private.share_company_key('  FIRM   y ') is distinct from private.share_company_key('Firm Y'),
  'a company name matches after trim and collapsed spaces, and keeps its case'
);

insert into auth.users (id, email)
values
  (:'ownerx', 'ownerx@firmx.test'),
  (:'cmx', 'cmx@firmx.test'),
  (:'opx', 'opx@firmx.test'),
  (:'ownery', 'ownery@firmy.test'),
  (:'cmy', 'cmy@firmy.test'),
  (:'opy', 'opy@firmy.test'),
  (:'ownerz', 'ownerz@firmz.test');

insert into public.companies (id, name)
values
  (:'firmx', 'Firm X'),
  (:'firmy', 'Firm Y'),
  (:'firmz', 'Firm Z');

insert into public.people (id, auth_user_id, company_id, role, display_name, email, phone, trade)
values
  (:'ownerx', :'ownerx', :'firmx', 'owner', 'Owner X', 'ownerx@firmx.test', '07000000001', null),
  (:'cmx', :'cmx', :'firmx', 'cm', 'CM X', 'secret-host@firmx.test', '07000900900', 'contracts'),
  (:'opx', :'opx', :'firmx', 'operative', 'Op Secret', 'op-secret@firmx.test', '07000900901', 'dryliner'),
  (:'ownery', :'ownery', :'firmy', 'owner', 'Owner Y', 'ownery@firmy.test', '07000000002', null),
  (:'cmy', :'cmy', :'firmy', 'cm', 'CM Y', 'cmy@firmy.test', '07000000004', 'contracts'),
  (:'opy', :'opy', :'firmy', 'operative', 'Op Y', 'opy@firmy.test', '07000000005', 'dryliner'),
  (:'ownerz', :'ownerz', :'firmz', 'owner', 'Owner Z', 'ownerz@firmz.test', '07000000003', null);

insert into public.sites (id, company_id, name, address_line)
values
  (:'sitea', :'firmx', 'Site A', '1 Host Street'),
  (:'siteb', :'firmx', 'Site B', '2 Other Street');

insert into public.site_assignments (site_id, person_id)
values
  (:'sitea', :'cmx'),
  (:'sitea', :'opx');

set session_replication_role = replica;

insert into public.drawings (id, site_id, title, sheet_number, revision, is_current, storage_path)
values
  ('d1111111-1111-4111-8111-111111111111', :'sitea', 'Current sheet', 'A-1', 'C', true, :'firmx' || '/' || :'sitea' || '/d3111111-1111-4111-8111-111111111111.pdf'),
  ('d1111111-1111-4111-8111-111111111112', :'sitea', 'Old sheet', 'A-1-old', 'B', false, :'firmx' || '/' || :'sitea' || '/d3111111-1111-4111-8111-111111111112.pdf'),
  ('d1111111-1111-4111-8111-111111111113', :'sitea', 'Bad path', 'A-9', 'A', true, '../secret.pdf'),
  ('d1111111-1111-4111-8111-111111111114', :'siteb', 'OTHER-SITE-SHEET', 'B-1', 'A', true, :'firmx' || '/' || :'siteb' || '/d3111111-1111-4111-8111-111111111114.pdf'),
  ('d1111111-1111-4111-8111-111111111115', :'sitea', 'Request photo', 'A-2', 'A', true, :'firmx' || '/' || :'sitea' || '/requests/photo.jpg'),
  ('d1111111-1111-4111-8111-111111111116', :'sitea', 'Talk PDF', 'A-3', 'A', true, :'firmx' || '/' || :'sitea' || '/talks/induction.pdf'),
  ('d1111111-1111-4111-8111-111111111117', :'sitea', 'Missing file', 'A-4', 'A', true, :'firmx' || '/' || :'sitea' || '/d3111111-1111-4111-8111-111111111117.pdf');

insert into storage.objects (bucket_id, name)
values
  ('drawings', :'firmx' || '/' || :'sitea' || '/d3111111-1111-4111-8111-111111111111.pdf'),
  ('drawings', :'firmx' || '/' || :'sitea' || '/requests/photo.jpg'),
  ('drawings', :'firmx' || '/' || :'sitea' || '/talks/induction.pdf');

insert into public.variations (id, site_id, company_id, vo_seq, created_by)
values
  ('aa111111-1111-4111-8111-111111111111', :'sitea', :'firmx', 1, :'ownerx'),
  ('aa111111-1111-4111-8111-111111111112', :'sitea', :'firmx', 2, :'ownerx'),
  ('aa111111-1111-4111-8111-111111111113', :'sitea', :'firmx', 3, :'ownerx'),
  ('aa111111-1111-4111-8111-111111111114', :'siteb', :'firmx', 1, :'ownerx');

insert into public.variation_versions (
  id, variation_id, site_id, version_no, title, description, status, is_current, created_by, value_pence
)
values
  ('e1111111-1111-4111-8111-111111111111', 'aa111111-1111-4111-8111-111111111111', :'sitea', 1, 'DRAFT-SECRET-PRICE', 'hidden', 'Draft', true, :'ownerx', 424242),
  ('e1111111-1111-4111-8111-111111111112', 'aa111111-1111-4111-8111-111111111112', :'sitea', 1, 'Sent extra', 'shown', 'Sent', true, :'ownerx', 515151),
  ('e1111111-1111-4111-8111-111111111113', 'aa111111-1111-4111-8111-111111111113', :'sitea', 1, 'Signed extra', 'shown', 'Signed', true, :'ownerx', 18000),
  ('e1111111-1111-4111-8111-111111111114', 'aa111111-1111-4111-8111-111111111114', :'siteb', 1, 'OTHER-SITE-VARIATION', 'hidden', 'Signed', true, :'ownerx', 999);

insert into public.variation_photos (version_id, site_id, storage_path, sort_order, content_type, file_size_bytes)
values
  ('e1111111-1111-4111-8111-111111111111', :'sitea', :'firmx' || '/' || :'sitea' || '/variations/draft.jpg', 1, 'image/jpeg', 100),
  ('e1111111-1111-4111-8111-111111111112', :'sitea', :'firmx' || '/' || :'sitea' || '/variations/sent.jpg', 1, 'image/jpeg', 100),
  ('e1111111-1111-4111-8111-111111111113', :'sitea', :'firmx' || '/' || :'sitea' || '/variations/signed.jpg', 1, 'image/jpeg', 100),
  ('e1111111-1111-4111-8111-111111111114', :'siteb', :'firmx' || '/' || :'siteb' || '/variations/other.jpg', 1, 'image/jpeg', 100);

insert into public.snags (
  id, site_id, company_id, snag_seq, note, trade_label, raised_by, raised_by_name, raised_at, status
)
values
  ('bb111111-1111-4111-8111-111111111111', :'sitea', :'firmx', 1, 'Crack by the door', 'dryliner', :'opx', 'Łukasz Wójcik', now(), 'Open'),
  ('bb111111-1111-4111-8111-111111111112', :'siteb', :'firmx', 1, 'OTHER-SITE-SNAG', 'dryliner', :'opx', 'Op Secret', now(), 'Open');

insert into public.site_attendance (
  id, site_id, company_id, person_id, person_name,
  in_device_at, in_received_at, in_at, in_gap,
  out_device_at, out_received_at, out_at, out_gap
)
values (
  'b1111111-1111-4111-8111-111111111111', :'sitea', :'firmx', :'opx', 'Łukasz Wójcik',
  now(), now(), now(), false,
  now(), now(), now(), false
);

insert into public.site_talks (
  id, site_id, company_id, kind, delivery, title, audience,
  presenter_person_id, presenter_name, presenter_role, presented_at, created_by
)
values
  (
    'cc111111-1111-4111-8111-111111111111', :'sitea', :'firmx', 'induction', 'phone', 'Site induction', 'all',
    :'ownerx', 'Owner X', 'Owner', now(), :'ownerx'
  ),
  (
    'cc111111-1111-4111-8111-111111111112', :'sitea', :'firmx', 'toolbox', 'phone', 'TOOLBOX-SECRET', 'all',
    :'ownerx', 'Owner X', 'Owner', now(), :'ownerx'
  );

insert into public.site_talk_versions (id, talk_id, site_id, company_id, version_no, body, content_hash, is_current, created_by)
values
  ('dd111111-1111-4111-8111-111111111111', 'cc111111-1111-4111-8111-111111111111', :'sitea', :'firmx', 2, 'Read this induction.', 'hash-induction', true, :'ownerx'),
  ('dd111111-1111-4111-8111-111111111113', 'cc111111-1111-4111-8111-111111111111', :'sitea', :'firmx', 1, 'OLD-INDUCTION-SECRET', 'hash-induction-old', false, :'ownerx'),
  ('dd111111-1111-4111-8111-111111111112', 'cc111111-1111-4111-8111-111111111112', :'sitea', :'firmx', 1, 'TOOLBOX-SECRET body', 'hash-toolbox', true, :'ownerx');

insert into public.site_talk_signatures (
  talk_id, version_id, site_id, company_id, person_id, person_name, captured_by, session_id,
  shared_device, signature_role, meaning, signature_png, device_at, received_at, content_hash
)
values (
  'cc111111-1111-4111-8111-111111111111', 'dd111111-1111-4111-8111-111111111111', :'sitea', :'firmx',
  :'opx', 'Łukasz Wójcik', :'opx', 'session-1',
  false, 'attendee', 'I have read the induction.', repeat('a', 40), now(), now(), 'hash-induction'
);

insert into public.site_talk_questions (
  talk_id, version_id, site_id, company_id, person_id, person_name, body, captured_by, session_id,
  shared_device, device_at, received_at
)
values (
  'cc111111-1111-4111-8111-111111111111', 'dd111111-1111-4111-8111-111111111111', :'sitea', :'firmx',
  :'opx', 'Op Secret', 'QUESTION-SECRET', :'opx', 'session-1',
  false, now(), now()
);

set session_replication_role = origin;

create temp table share_probe (k text primary key, v jsonb);
grant all on table share_probe to authenticated;

select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_site_share_invite(' || quote_literal(:'sitea') || '::uuid, ''Firm X'', false, false, false, false, false, ' || quote_literal(:'hashok') || ')',
    'own_firm'
  ),
  'an owner cannot share a site with their own firm'
);

select pg_temp.ok(
  private.can_access_site(:'sitea'::uuid)
  and private.can_access_site(:'siteb'::uuid)
  and (select count(*) from public.variation_versions where title = 'DRAFT-SECRET-PRICE') = 1
  and (select count(*) from public.drawings where title = 'OTHER-SITE-SHEET') = 1
  and (select count(*) from public.site_talk_versions where body = 'OLD-INDUCTION-SECRET') = 1,
  'the host owner still sees drafts, the old induction, and the other site'
);

insert into share_probe (k, v)
values
  ('ok', public.create_site_share_invite(:'sitea'::uuid, 'Firm Y', true, true, true, false, false, :'hashok')),
  ('used', public.create_site_share_invite(:'sitea'::uuid, 'Firm Y', true, false, false, false, false, :'hashused')),
  ('other', public.create_site_share_invite(:'sitea'::uuid, 'Firm Y', true, false, false, false, false, :'hashother')),
  ('rev', public.create_site_share_invite(:'sitea'::uuid, 'Firm Y', false, false, false, false, false, :'hashrev')),
  ('exp', public.create_site_share_invite(:'sitea'::uuid, 'Firm Y', false, false, false, false, false, :'hashexp')),
  ('op', public.create_site_share_invite(:'sitea'::uuid, 'Firm Y', true, false, false, false, false, :'hashop')),
  ('look', public.create_site_share_invite(:'sitea'::uuid, '  FIRM   y ', false, false, false, false, false, :'hashlook')),
  ('space', public.create_site_share_invite(:'sitea'::uuid, '  Firm   Y ', false, false, false, false, false, :'hashspace'));

select pg_temp.ok(
  (select guest_company_key from public.site_share_invites where guest_company_name = 'FIRM   y') = 'FIRM y'
  and (select guest_company_key from public.site_share_invites where guest_company_name = 'Firm   Y') = 'Firm Y',
  'the stored company key collapses spaces and keeps case'
);

select pg_temp.ok(
  (share_probe.v ->> 'expires_at')::timestamptz > now() + interval '6 days'
  and (share_probe.v ->> 'expires_at')::timestamptz < now() + interval '8 days',
  'a share code expires in seven days'
)
from share_probe
where k = 'ok';

select public.revoke_site_share_invite((share_probe.v ->> 'id')::uuid)
from share_probe
where k = 'rev';

reset role;
update public.site_share_invites
set expires_at = now() - interval '1 minute'
where code_hash = decode(:'hashexp', 'hex');

select pg_temp.jwt(:'ownerz'::uuid);
set local role authenticated;
select pg_temp.ok(
  (public.redeem_site_share(:'hashother') ->> 'error') = 'other_firm',
  'a different firm cannot redeem the code'
);

select pg_temp.jwt(:'ownery'::uuid);
select pg_temp.ok(
  (public.redeem_site_share(:'hashexp') ->> 'error') = 'code_expired'
  and (public.redeem_site_share(:'hashrev') ->> 'error') = 'code_revoked',
  'an expired or revoked code is refused'
);

insert into share_probe (k, v)
values ('redeemed_used', public.redeem_site_share(:'hashused'));

select pg_temp.ok(
  (public.redeem_site_share(:'hashused') ->> 'share_id')
    = (select v ->> 'share_id' from share_probe where k = 'redeemed_used'),
  'a second redeem of the same code returns the same share'
);

select pg_temp.jwt(:'opy'::uuid);
select pg_temp.ok(
  (public.redeem_site_share(:'hashused') ->> 'error') = 'not_allowed',
  'an operative cannot redeem a code, even one their firm already opened'
);
select pg_temp.jwt(:'ownery'::uuid);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;
select public.revoke_site_share((share_probe.v ->> 'share_id')::uuid)
from share_probe
where k = 'redeemed_used';

select pg_temp.jwt(:'ownery'::uuid);
insert into share_probe (k, v)
values ('redeemed', public.redeem_site_share(:'hashok'));

select pg_temp.ok(
  not private.can_access_site(:'sitea'::uuid)
  and not private.can_access_site(:'siteb'::uuid),
  'a share does not widen can_access_site'
);

select pg_temp.ok(
  (select count(*) from public.drawings where site_id = :'sitea'::uuid and is_current and title = 'Current sheet') = 1
  and (select count(*) from public.drawings where site_id = :'sitea'::uuid and not is_current) = 0
  and (select count(*) from public.drawings where site_id = :'siteb'::uuid) = 0
  and (select count(*) from public.drawings where title = 'OTHER-SITE-SHEET') = 0
  and jsonb_array_length(public.shared_drawings(:'sitea'::uuid)) = 5
  and exists (
    select 1
    from jsonb_array_elements(public.shared_drawings(:'sitea'::uuid)) row
    where row ->> 'title' = 'Current sheet'
  ),
  'firm Y sees only the current drawings on the shared site'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.shared_drawing_url(''d1111111-1111-4111-8111-111111111113''::uuid)',
    'invalid_path'
  )
  and pg_temp.raises(
    'select public.shared_drawing_url(''d1111111-1111-4111-8111-111111111112''::uuid)',
    'not_current'
  )
  and pg_temp.raises(
    'select public.shared_drawing_url(''d1111111-1111-4111-8111-111111111114''::uuid)',
    'not_shared'
  )
  and (public.shared_drawing_url('d1111111-1111-4111-8111-111111111111'::uuid) ->> 'path')
    = :'firmx' || '/' || :'sitea' || '/d3111111-1111-4111-8111-111111111111.pdf'
  and (public.shared_drawing_url('d1111111-1111-4111-8111-111111111111'::uuid) ->> 'expires_in') = '300',
  'a shared drawing URL checks the share and rejects a bad path'
);

select pg_temp.jwt(:'ownerz'::uuid);
select pg_temp.ok(
  pg_temp.raises(
    'select public.shared_drawing_url(''d1111111-1111-4111-8111-111111111112''::uuid)',
    'not_shared'
  )
  and pg_temp.raises(
    'select public.shared_drawing_url(''d1111111-1111-4111-8111-111111111111''::uuid)',
    'not_shared'
  ),
  'a drawing outside this caller''s share is not_shared, including a superseded sheet'
);
select pg_temp.jwt(:'ownery'::uuid);

do $paths$
declare
  v_role uuid;
  v_drawing uuid;
begin
  foreach v_role in array array[
    'a2222222-2222-4222-8222-222222222221'::uuid,
    'a2222222-2222-4222-8222-222222222222'::uuid,
    'a2222222-2222-4222-8222-222222222223'::uuid
  ]
  loop
    perform set_config('request.jwt.claim.sub', v_role::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_role::text, 'role', 'authenticated')::text,
      true
    );
    foreach v_drawing in array array[
      'd1111111-1111-4111-8111-111111111115'::uuid,
      'd1111111-1111-4111-8111-111111111116'::uuid,
      'd1111111-1111-4111-8111-111111111117'::uuid
    ]
    loop
      begin
        perform public.shared_drawing_url(v_drawing);
        raise exception 'FAIL: signed % for %', v_drawing, v_role;
      exception
        when others then
          if sqlerrm is distinct from 'invalid_path' then
            raise exception 'FAIL: drawing % role % -> %', v_drawing, v_role, sqlerrm;
          end if;
      end;
    end loop;
  end loop;
  raise notice 'ok: a request photo, a talk PDF, and a missing file are invalid_path for every guest role';
end
$paths$;

select pg_temp.jwt(:'ownery'::uuid);

select pg_temp.ok(
  (select count(*) from public.variation_versions where status = 'Draft') = 0
  and (select count(*) from public.variation_versions where title = 'DRAFT-SECRET-PRICE') = 0
  and (select count(*) from public.variation_versions where title = 'OTHER-SITE-VARIATION') = 0
  and (select count(*) from public.variation_versions where status in ('Signed', 'Sent')) = 2
  and (select count(*) from public.variations) = 2
  and jsonb_array_length(public.shared_variations(:'sitea'::uuid)) = 2
  and not (public.shared_variations(:'sitea'::uuid)::text like '%424242%')
  and not (public.shared_variations(:'sitea'::uuid)::text like '%515151%')
  and not (public.shared_variations(:'sitea'::uuid)::text like '%DRAFT-SECRET-PRICE%'),
  'draft variations and prices are not returned'
);

select pg_temp.ok(
  (select count(*) from public.snags where site_id = :'sitea'::uuid) = 1
  and (select count(*) from public.snags where note = 'OTHER-SITE-SNAG') = 0
  and jsonb_array_length(public.shared_snags(:'sitea'::uuid)) = 1
  and (public.shared_snags(:'sitea'::uuid) -> 0 ->> 'raised_by_name') = 'Łukasz Wójcik'
  and (select count(*) from public.site_attendance) = 0
  and (select count(*) from public.site_talks) = 0
  and (select count(*) from public.site_talk_questions) = 0
  and pg_temp.raises(
    'select public.shared_sign_in_register(' || quote_literal(:'sitea') || '::uuid)',
    'section_off'
  )
  and pg_temp.raises(
    'select public.shared_induction_register(' || quote_literal(:'sitea') || '::uuid)',
    'section_off'
  )
  and pg_temp.raises(
    'select public.shared_drawings(' || quote_literal(:'siteb') || '::uuid)',
    'not_shared'
  ),
  'an unshared section and the host''s other site are refused'
);

select pg_temp.ok(
  (select count(*) from public.sites where id = :'sitea'::uuid) = 1
  and (select count(*) from public.sites where id = :'siteb'::uuid) = 0
  and (select count(*) from public.people where display_name in ('CM X', 'Op Secret', 'Owner X')) = 0
  and (public.shared_site_view(:'sitea'::uuid) ->> 'cm_contact_name') = 'CM X'
  and not ((public.shared_site_view(:'sitea'::uuid)::text) like '%secret-host@firmx.test%')
  and not ((public.shared_site_view(:'sitea'::uuid)::text) like '%07000900900%')
  and not ((public.shared_site_view(:'sitea'::uuid)::text) like '%op-secret%')
  and (select count(*) from public.site_share_audit) = 0,
  'host people emails and phones are not returned'
);

select pg_temp.ok(
  pg_temp.raises('select email from public.people', 'permission denied for column email')
  or pg_temp.raises('select email from public.people', 'permission denied for table people'),
  'email cannot be selected'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;
select public.set_site_share_sections(
  (select (v ->> 'share_id')::uuid from share_probe where k = 'redeemed'),
  true, true, true, true, true
);

select pg_temp.jwt(:'ownery'::uuid);
select pg_temp.ok(
  (select count(*) from public.site_attendance) = 1
  and (public.shared_sign_in_register(:'sitea'::uuid) -> 0 ->> 'person_name') = 'Łukasz Wójcik'
  and not ((public.shared_sign_in_register(:'sitea'::uuid)::text) like '%07000900900%')
  and (select count(*) from public.site_talks where kind = 'induction') = 1
  and (select count(*) from public.site_talks where title = 'TOOLBOX-SECRET') = 0
  and (select count(*) from public.site_talk_questions) = 0
  and (public.shared_induction_register(:'sitea'::uuid) -> 0 ->> 'person_name') = 'Łukasz Wójcik'
  and (public.shared_induction_register(:'sitea'::uuid) -> 0 ->> 'id') is not null
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%QUESTION-SECRET%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%' || repeat('a', 40) || '%')
  and not has_column_privilege('authenticated', 'public.site_talk_signatures', 'signature_png', 'select')
  and has_column_privilege('authenticated', 'public.site_talk_signatures', 'person_name', 'select')
  and pg_temp.raises(
    'select signature_png from public.site_talk_signatures',
    'permission denied for table site_talk_signatures'
  )
  and (select person_name from public.site_talk_signatures) = 'Łukasz Wójcik'
  and (select meaning from public.site_talk_signatures) = 'I have read the induction.'
  and (select received_at from public.site_talk_signatures) is not null
  and (select count(*) from public.site_talk_versions where body = 'OLD-INDUCTION-SECRET') = 0
  and (select count(*) from public.site_talk_versions where body = 'Read this induction.') = 1
  and (select count(*) from public.site_talk_versions) = 1,
  'turning a section on shows the register names and still hides the toolbox, questions, and old induction text'
);

do $write$
declare
  v_snag text;
  v_drawing text;
begin
  begin
    insert into public.snags (site_id, company_id, snag_seq, note, trade_label, raised_by, raised_by_name, raised_at, status)
    values ('51111111-1111-4111-8111-111111111111'::uuid, 'c1111111-1111-4111-8111-111111111111'::uuid, 9, 'Guest note', 'dryliner', 'a2222222-2222-4222-8222-222222222221'::uuid, 'Owner Y', now(), 'Open');
    v_snag := 'inserted';
  exception
    when others then
      v_snag := sqlerrm;
  end;
  begin
    insert into public.drawings (site_id, title, revision, is_current, storage_path)
    values ('51111111-1111-4111-8111-111111111111'::uuid, 'Guest upload', 'A', true, 'x/y/z.pdf');
    v_drawing := 'inserted';
  exception
    when others then
      v_drawing := sqlerrm;
  end;
  if v_snag not like '%permission denied%' and v_snag not like '%row-level security%' then
    raise exception 'FAIL: guest write snag [%] drawing [%]', v_snag, v_drawing;
  end if;
  if v_drawing not like '%permission denied%' and v_drawing not like '%row-level security%' then
    raise exception 'FAIL: guest write snag [%] drawing [%]', v_snag, v_drawing;
  end if;
  raise notice 'ok: the guest firm cannot write the host site';
end
$write$;

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;
select public.revoke_site_share((select (v ->> 'share_id')::uuid from share_probe where k = 'redeemed'));

select pg_temp.ok(
  (select count(*) from public.site_share_audit where action = 'created') >= 1
  and (select count(*) from public.site_share_audit where action = 'redeemed') >= 1
  and (select count(*) from public.site_share_audit where action = 'sections_changed') >= 1
  and (select count(*) from public.site_share_audit where action = 'revoked') >= 1
  and (select count(*) from public.site_share_audit where action = 'view_granted') >= 1,
  'create, redeem, section change, revoke, and view grant are audited'
);

select pg_temp.jwt(:'ownery'::uuid);
select pg_temp.ok(
  (select count(*) from public.drawings) = 0
  and (select count(*) from public.variation_versions) = 0
  and (select count(*) from public.snags) = 0
  and (select count(*) from public.sites where id = :'sitea'::uuid) = 0
  and pg_temp.raises(
    'select public.shared_site_view(' || quote_literal(:'sitea') || '::uuid)',
    'share_revoked'
  )
  and pg_temp.raises(
    'select public.shared_drawings(' || quote_literal(:'sitea') || '::uuid)',
    'share_revoked'
  ),
  'revoke removes access on the next request'
);

select pg_temp.jwt(:'ownery'::uuid);
select pg_temp.ok(
  (public.redeem_site_share(:'hashlook') ->> 'error') = 'other_firm',
  'a lookalike company name does not match'
);

select pg_temp.jwt(:'opy'::uuid);
select pg_temp.ok(
  (public.redeem_site_share(:'hashop') ->> 'error') = 'not_allowed',
  'an operative cannot open a fresh code'
);

reset role;
select pg_temp.ok(
  (select uses from public.site_share_invites where code_hash = decode(:'hashop', 'hex')) = 0,
  'an operative refusal does not use the code'
);

select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;
select pg_temp.ok(
  (public.redeem_site_share(:'hashop') ->> 'site_id') = :'sitea',
  'the firm owner can still redeem after an operative is refused'
);

reset role;
delete from public.site_share_attempts where actor_id = :'ownery'::uuid;
select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;
do $rate$
declare
  v_i integer;
  v_err text;
begin
  for v_i in 1..10 loop
    v_err := public.redeem_site_share('abcd') ->> 'error';
    if v_err is distinct from 'invalid_input' then
      raise exception 'FAIL: attempt % -> %', v_i, v_err;
    end if;
  end loop;
  v_err := public.redeem_site_share('abcd') ->> 'error';
  if v_err is distinct from 'too_many_attempts' then
    raise exception 'FAIL: 11th attempt -> %', v_err;
  end if;
  raise notice 'ok: ten failed redeems then too_many_attempts';
end
$rate$;

reset role;
select pg_temp.ok(
  (select count(*) from public.site_share_attempts where actor_id = :'ownery'::uuid) = 10,
  'too_many_attempts does not insert another row'
);

