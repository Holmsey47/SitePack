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
\set hashrename '1212121212121212121212121212121212121212121212121212121212121212'
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

-- Redeem and preview are service_role only. These wrappers set that claim for
-- the call, then put the session claims back. The user id is an argument.
create or replace function pg_temp.redeem(p_user uuid, p_hash text, p_ip text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_out jsonb;
  v_claims text := current_setting('request.jwt.claims', true);
  v_role text := current_setting('request.jwt.claim.role', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_out := public.redeem_site_share(p_user, p_hash, p_ip);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_out;
exception
  when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    raise;
end;
$$;

create or replace function pg_temp.preview(p_user uuid, p_hash text, p_ip text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_out jsonb;
  v_claims text := current_setting('request.jwt.claims', true);
  v_role text := current_setting('request.jwt.claim.role', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_out := public.preview_site_share(p_user, p_hash, p_ip);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_out;
exception
  when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    raise;
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

create or replace function pg_temp.keys_of(p_row jsonb)
returns text[]
language sql
as $$
  select coalesce(array(select jsonb_object_keys(p_row) order by 1), array[]::text[]);
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
  if v_expected <> 28 or v_replaced <> 2 then
    raise exception 'FAIL: migration list expected 28 new and 2 replaced, found % / %', v_expected, v_replaced;
  end if;
  if v_count <> 28 then
    raise exception 'FAIL: expected 28 new functions, found %', v_count;
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
  private.share_company_key('  Firm   Y ') = 'firm y'
  and private.share_company_key('  FIRM   y ') = 'firm y'
  and private.share_company_key('  FIRM   y ') = private.share_company_key('Firm Y')
  and private.share_company_key('Firm YY') is distinct from private.share_company_key('Firm Y'),
  'a company name matches after trim, collapsed spaces, and lower case'
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
  ('drawings', :'firmx' || '/' || :'sitea' || '/talks/induction.pdf'),
  ('drawings', :'firmx' || '/' || :'sitea' || '/talks/TALKPDF-SECRET.pdf');

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
  id, site_id, company_id, snag_seq, note, trade_label,
  raised_by, raised_by_name, raised_at, status,
  fixed_by, fixed_by_name, fixed_at, fixed_received_at
)
values
  (
    'bb111111-1111-4111-8111-111111111111', :'sitea', :'firmx', 1, 'Crack by the door', 'dryliner',
    :'opx', 'Łukasz Wójcik', now(), 'Fixed',
    :'opy', 'Op Y', now(), now()
  ),
  (
    'bb111111-1111-4111-8111-111111111112', :'siteb', :'firmx', 1, 'OTHER-SITE-SNAG', 'dryliner',
    :'opx', 'Op Secret', now(), 'Open',
    null, null, null, null
  );

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

insert into public.site_talk_versions (
  id, talk_id, site_id, company_id, version_no, body, pdf_path, pdf_content_type, pdf_size_bytes, pdf_object_fingerprint, content_hash, is_current, created_by
)
values
  (
    'dd111111-1111-4111-8111-111111111111', 'cc111111-1111-4111-8111-111111111111', :'sitea', :'firmx', 2,
    'Read this induction.', :'firmx' || '/' || :'sitea' || '/talks/TALKPDF-SECRET.pdf', 'application/pdf', 128,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'hash-induction', true, :'ownerx'
  ),
  (
    'dd111111-1111-4111-8111-111111111113', 'cc111111-1111-4111-8111-111111111111', :'sitea', :'firmx', 1,
    'OLD-INDUCTION-SECRET', null, null, null, null, 'hash-induction-old', false, :'ownerx'
  ),
  (
    'dd111111-1111-4111-8111-111111111112', 'cc111111-1111-4111-8111-111111111112', :'sitea', :'firmx', 1,
    'TOOLBOX-SECRET body', null, null, null, null, 'hash-toolbox', true, :'ownerx'
  );

insert into public.site_talk_signatures (
  talk_id, version_id, site_id, company_id, person_id, person_name, signer_name, captured_by, session_id,
  shared_device, signature_role, meaning, signature_png, device_at, received_at, content_hash
)
values (
  'cc111111-1111-4111-8111-111111111111', 'dd111111-1111-4111-8111-111111111111', :'sitea', :'firmx',
  :'opx', 'Łukasz Wójcik', 'Łukasz Wójcik', :'opx', 'session-1',
  false, 'attendee', 'I have read the induction.', 'SIGIMAGE-SECRET-' || repeat('Z', 24), now(), now(), 'hash-induction'
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

insert into public.site_talk_notes (
  talk_id, version_id, person_id, site_id, company_id,
  explained_verbally, interpreter_used, noted_by
)
values (
  'cc111111-1111-4111-8111-111111111111', 'dd111111-1111-4111-8111-111111111111', :'opx', :'sitea', :'firmx',
  true, true, :'ownerx'
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
  ('look', public.create_site_share_invite(:'sitea'::uuid, 'Firm YY', false, false, false, false, false, :'hashlook')),
  ('rename', public.create_site_share_invite(:'sitea'::uuid, 'Invited Builders', true, true, true, true, true, :'hashrename')),
  ('space', public.create_site_share_invite(:'sitea'::uuid, '  Firm   Y ', false, false, false, false, false, :'hashspace'));

select pg_temp.ok(
  (select guest_company_key from public.site_share_invites where guest_company_name = 'Firm   Y') = 'firm y'
  and (select guest_company_key from public.site_share_invites where guest_company_name = 'Firm YY') = 'firm yy',
  'the stored company key collapses spaces and lower-cases the name'
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
  (pg_temp.redeem(:'ownerz'::uuid, :'hashother', null) ->> 'error') = 'invalid_input',
  'a different firm cannot redeem the code'
);

select pg_temp.jwt(:'ownery'::uuid);
select pg_temp.ok(
  (pg_temp.redeem(:'ownery'::uuid, :'hashexp', null) ->> 'error') = 'invalid_input'
  and (pg_temp.redeem(:'ownery'::uuid, :'hashrev', null) ->> 'error') = 'invalid_input',
  'an expired or revoked code is refused with the same error as a bad code'
);

insert into share_probe (k, v)
values ('redeemed_used', pg_temp.redeem(:'ownery'::uuid, :'hashused', null));

select pg_temp.ok(
  (pg_temp.redeem(:'ownery'::uuid, :'hashused', null) ->> 'share_id')
    = (select v ->> 'share_id' from share_probe where k = 'redeemed_used'),
  'a second redeem of the same code returns the same share'
);

select pg_temp.jwt(:'opy'::uuid);
select pg_temp.ok(
  (pg_temp.redeem(:'opy'::uuid, :'hashused', null) ->> 'error') = 'invalid_input',
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
select pg_temp.ok(
  (pg_temp.redeem(:'ownery'::uuid, :'hashused', null) ->> 'error') = 'invalid_input',
  'a used code returns the same error as a bad code'
);

select pg_temp.ok(
  (pg_temp.preview(:'ownery'::uuid, :'hashok', null) ->> 'site_name') = 'Site A'
  and (pg_temp.preview(:'ownery'::uuid, :'hashok', null) ->> 'host_company_name') = 'Firm X'
  and (pg_temp.preview(:'ownery'::uuid, :'hashok', null) -> 'sections' ->> 'drawings') = 'true'
  and (pg_temp.preview(:'ownery'::uuid, :'hashok', null) -> 'sections' ->> 'snags') = 'true'
  and (pg_temp.preview(:'ownery'::uuid, :'hashok', null) -> 'sections' ->> 'sign_in') = 'false'
  and position('@' in (pg_temp.preview(:'ownery'::uuid, :'hashok', null))::text) = 0
  and pg_temp.raises(
    'select public.shared_drawings(' || quote_literal(:'sitea') || '::uuid)',
    'share_revoked'
  ),
  'a code preview names the site and sections and does not grant access'
);

reset role;
select pg_temp.ok(
  (select uses from public.site_share_invites where code_hash = decode(:'hashok', 'hex')) = 0
  and not exists (
    select 1
    from public.site_shares s
    join public.site_share_invites i on i.id = s.invite_id
    where i.code_hash = decode(:'hashok', 'hex')
  ),
  'a code preview does not use the code or open a share'
);
select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;

select pg_temp.jwt(:'ownerz'::uuid);
select pg_temp.ok(
  (pg_temp.preview(:'ownerz'::uuid, :'hashok', null) ->> 'error') = 'invalid_input'
  and (pg_temp.preview(:'ownerz'::uuid, 'abcd', null) ->> 'error') = 'invalid_input',
  'a preview for another firm returns the same error as a bad code'
);

select pg_temp.jwt(:'opy'::uuid);
select pg_temp.ok(
  (pg_temp.preview(:'opy'::uuid, :'hashop', null) ->> 'error') = 'invalid_input',
  'an operative cannot preview a code open'
);
reset role;
select pg_temp.ok(
  (select uses from public.site_share_invites where code_hash = decode(:'hashop', 'hex')) = 0,
  'an operative preview does not use the code'
);

select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;

insert into share_probe (k, v)
values ('redeemed', pg_temp.redeem(:'ownery'::uuid, :'hashok', null));

select pg_temp.ok(
  (select v ->> 'status' from share_probe where k = 'redeemed') = 'pending'
  and pg_temp.raises(
    'select public.shared_drawings(' || quote_literal(:'sitea') || '::uuid)',
    'not_shared'
  )
  and (select count(*) from public.drawings) = 0
  and (select count(*) from public.sites where id = :'sitea'::uuid) = 0,
  'a pending share grants no rpc and no table rows'
);

select pg_temp.jwt(:'cmx'::uuid);
select public.approve_site_share((select (v ->> 'share_id')::uuid from share_probe where k = 'redeemed'));
select pg_temp.jwt(:'ownery'::uuid);

select pg_temp.ok(
  not private.can_access_site(:'sitea'::uuid)
  and not private.can_access_site(:'siteb'::uuid),
  'a share does not widen can_access_site'
);

select pg_temp.ok(
  (select count(*) from public.drawings) = 0
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
    'select public.shared_drawing_url(''51111111-1111-4111-8111-111111111111''::uuid, ''d1111111-1111-4111-8111-111111111113''::uuid)',
    'invalid_path'
  )
  and pg_temp.raises(
    'select public.shared_drawing_url(''51111111-1111-4111-8111-111111111111''::uuid, ''d1111111-1111-4111-8111-111111111112''::uuid)',
    'not_current'
  )
  and pg_temp.raises(
    'select public.shared_drawing_url(''51111111-1111-4111-8111-111111111111''::uuid, ''d1111111-1111-4111-8111-111111111114''::uuid)',
    'not_shared'
  )
  and (public.shared_drawing_url('51111111-1111-4111-8111-111111111111'::uuid, 'd1111111-1111-4111-8111-111111111111'::uuid) ->> 'path')
    = :'firmx' || '/' || :'sitea' || '/d3111111-1111-4111-8111-111111111111.pdf'
  and (public.shared_drawing_url('51111111-1111-4111-8111-111111111111'::uuid, 'd1111111-1111-4111-8111-111111111111'::uuid) ->> 'expires_in') = '300',
  'a shared drawing URL checks the share and rejects a bad path'
);

select pg_temp.jwt(:'ownerz'::uuid);
select pg_temp.ok(
  pg_temp.raises(
    'select public.shared_drawing_url(''51111111-1111-4111-8111-111111111111''::uuid, ''d1111111-1111-4111-8111-111111111112''::uuid)',
    'not_shared'
  )
  and pg_temp.raises(
    'select public.shared_drawing_url(''51111111-1111-4111-8111-111111111111''::uuid, ''d1111111-1111-4111-8111-111111111111''::uuid)',
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
        perform public.shared_drawing_url('51111111-1111-4111-8111-111111111111'::uuid, v_drawing);
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
  and (select count(*) from public.variation_versions where status in ('Signed', 'Sent')) = 0
  and (select count(*) from public.variations) = 0
  and jsonb_array_length(public.shared_variations(:'sitea'::uuid)) = 2
  and not (public.shared_variations(:'sitea'::uuid)::text like '%424242%')
  and not (public.shared_variations(:'sitea'::uuid)::text like '%515151%')
  and not (public.shared_variations(:'sitea'::uuid)::text like '%DRAFT-SECRET-PRICE%'),
  'draft variations and prices are not returned'
);

select pg_temp.ok(
  (select count(*) from public.snags where site_id = :'sitea'::uuid) = 0
  and (select count(*) from public.snags where note = 'OTHER-SITE-SNAG') = 0
  and jsonb_array_length(public.shared_snags(:'sitea'::uuid)) = 1
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
  pg_temp.keys_of(public.shared_snags(:'sitea'::uuid) -> 0)
    = array['fixed_by_company', 'id', 'level_area', 'note', 'raised_at', 'raised_by_company', 'snag_seq', 'status', 'trade_label']::text[]
  and (public.shared_snags(:'sitea'::uuid) -> 0 ->> 'raised_by_company') = 'Firm X'
  and (public.shared_snags(:'sitea'::uuid) -> 0 ->> 'fixed_by_company') = 'Firm Y'
  and (public.shared_snags(:'sitea'::uuid) -> 0 ->> 'id') = 'bb111111-1111-4111-8111-111111111111'
  and not ((public.shared_snags(:'sitea'::uuid)::text) like '%Łukasz Wójcik%')
  and not ((public.shared_snags(:'sitea'::uuid)::text) like '%Op Secret%')
  and not ((public.shared_snags(:'sitea'::uuid)::text) like '%Op Y%')
  and not ((public.shared_snags(:'sitea'::uuid)::text) like '%raised_by_name%')
  and not ((public.shared_snags(:'sitea'::uuid)::text) like '%fixed_by_name%')
  and not ((public.shared_snags(:'sitea'::uuid)::text) like '%person_id%')
  and not ((public.shared_snags(:'sitea'::uuid)::text) like '%user_id%')
  and not ((public.shared_snags(:'sitea'::uuid)::text) like '%username%')
  and not ((public.shared_snags(:'sitea'::uuid)::text) like '%@%')
  and not ((public.shared_snags(:'sitea'::uuid)::text) like '%0700%')
  and not ((public.shared_snags(:'sitea'::uuid)::text) like '%' || :'opx' || '%')
  and not ((public.shared_snags(:'sitea'::uuid)::text) like '%' || :'opy' || '%'),
  'guest snags show the company and not the operative name'
);

select pg_temp.ok(
  (select count(*) from public.sites where id = :'sitea'::uuid) = 0
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
  (
    select bool_and(
      pg_temp.keys_of(elem) = array[
        'description', 'id', 'level_area', 'quantity_text', 'signer_company', 'signer_name',
        'status', 'title', 'version_id', 'vo_seq'
      ]::text[]
    )
    from jsonb_array_elements(public.shared_variations(:'sitea'::uuid)) elem
  )
  and not ((public.shared_variations(:'sitea'::uuid)::text) like '%@%')
  and not ((public.shared_variations(:'sitea'::uuid)::text) like '%person_id%')
  and not ((public.shared_variations(:'sitea'::uuid)::text) like '%user_id%')
  and not ((public.shared_variations(:'sitea'::uuid)::text) like '%username%')
  and not ((public.shared_variations(:'sitea'::uuid)::text) like '%0700%')
  and pg_temp.keys_of(public.shared_site_view(:'sitea'::uuid))
    = array['address_line', 'cm_contact_name', 'host_company_name', 'sections', 'site_id', 'site_name']::text[]
  and not ((public.shared_site_view(:'sitea'::uuid)::text) like '%@%')
  and not ((public.shared_site_view(:'sitea'::uuid)::text) like '%person_id%')
  and not ((public.shared_site_view(:'sitea'::uuid)::text) like '%user_id%')
  and not ((public.shared_site_view(:'sitea'::uuid)::text) like '%username%')
  and not ((public.shared_site_view(:'sitea'::uuid)::text) like '%0700%'),
  'guest people fields are name and company only'
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
  (select count(*) from public.site_attendance) = 0
  and jsonb_array_length(public.shared_sign_in_register(:'sitea'::uuid)) = 1
  and pg_temp.keys_of(public.shared_sign_in_register(:'sitea'::uuid) -> 0)
    = array['company_name', 'in_at', 'out_at', 'person_name']::text[]
  and (public.shared_sign_in_register(:'sitea'::uuid) -> 0 ->> 'person_name') = 'Łukasz Wójcik'
  and (public.shared_sign_in_register(:'sitea'::uuid) -> 0 ->> 'company_name') = 'Firm X'
  and (public.shared_sign_in_register(:'sitea'::uuid) -> 0 ->> 'in_at') is not null
  and (public.shared_sign_in_register(:'sitea'::uuid) -> 0 ->> 'out_at') is not null
  and not ((public.shared_sign_in_register(:'sitea'::uuid)::text) like '%07000900900%')
  and not ((public.shared_sign_in_register(:'sitea'::uuid)::text) like '%07000900901%')
  and not ((public.shared_sign_in_register(:'sitea'::uuid)::text) like '%@%')
  and not ((public.shared_sign_in_register(:'sitea'::uuid)::text) like '%person_id%')
  and not ((public.shared_sign_in_register(:'sitea'::uuid)::text) like '%user_id%')
  and not ((public.shared_sign_in_register(:'sitea'::uuid)::text) like '%username%')
  and not ((public.shared_sign_in_register(:'sitea'::uuid)::text) like '%email%')
  and not ((public.shared_sign_in_register(:'sitea'::uuid)::text) like '%phone%')
  and not ((public.shared_sign_in_register(:'sitea'::uuid)::text) like '%Op Secret%')
  and not ((public.shared_sign_in_register(:'sitea'::uuid)::text) like '%' || :'opx' || '%')
  and (select count(*) from public.site_talks where kind = 'induction') = 0
  and (select count(*) from public.site_talks where title = 'TOOLBOX-SECRET') = 0
  and (select count(*) from public.site_talk_questions) = 0
  and jsonb_array_length(public.shared_induction_register(:'sitea'::uuid)) = 1
  and pg_temp.keys_of(public.shared_induction_register(:'sitea'::uuid) -> 0)
    = array['company_name', 'person_name', 'received_at', 'status']::text[]
  and (public.shared_induction_register(:'sitea'::uuid) -> 0 ->> 'person_name') = 'Łukasz Wójcik'
  and (public.shared_induction_register(:'sitea'::uuid) -> 0 ->> 'company_name') = 'Firm X'
  and (public.shared_induction_register(:'sitea'::uuid) -> 0 ->> 'status') = 'Signed'
  and (public.shared_induction_register(:'sitea'::uuid) -> 0 ->> 'received_at') is not null
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%Site induction%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%I have read%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%Read this induction%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%TALKPDF-SECRET%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%talks/%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%QUESTION-SECRET%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%SIGIMAGE-SECRET%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%signature_png%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%@%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%person_id%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%user_id%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%username%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%email%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%phone%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%0700%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%Op Secret%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%' || :'opx' || '%')
  and not ((public.shared_induction_register(:'sitea'::uuid)::text) like '%cc111111-1111-4111-8111-111111111111%')
  and (select count(*) from public.site_talk_versions where body = 'OLD-INDUCTION-SECRET') = 0
  and (select count(*) from public.site_talk_versions where body = 'Read this induction.') = 0
  and (select count(*) from public.site_talk_versions) = 0
  and pg_temp.keys_of(public.my_shared_sites() -> 0)
    = array['cm_contact_name', 'host_company_name', 'sections', 'share_id', 'site_id', 'site_name']::text[]
  and not ((public.my_shared_sites()::text) like '%@%')
  and not ((public.my_shared_sites()::text) like '%person_id%')
  and not ((public.my_shared_sites()::text) like '%0700%'),
  'guest registers return only name, company, times, and induction status'
);

-- Probe guest_direct_reads.
-- Assertion: guest owner, cm, and operative read 0 rows from every shared table and storage.
-- Probe guest_signature_policy.
-- Assertion: site_talk_signatures_select has no guest branch. Putting that branch back fails this suite.
do $guest_direct_reads$
declare
  v_role uuid;
  v_roles uuid[] := array[
    'a2222222-2222-4222-8222-222222222221'::uuid,
    'a2222222-2222-4222-8222-222222222222'::uuid,
    'a2222222-2222-4222-8222-222222222223'::uuid
  ];
  v_count bigint;
  v_table text;
  v_tables text[] := array[
    'sites',
    'drawings',
    'variations',
    'variation_versions',
    'variation_photos',
    'variation_signatures',
    'snags',
    'site_attendance',
    'site_talks',
    'site_talk_versions',
    'site_talk_signatures',
    'site_talk_questions',
    'site_talk_notes'
  ];
  v_name text;
  v_expr text;
begin
  execute 'reset role';
  for v_name, v_expr in
    select c.relname || '.' || pol.polname,
      coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
        || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where (n.nspname = 'public' and c.relname = any (v_tables))
       or (n.nspname = 'storage' and c.relname = 'objects')
  loop
    if v_expr like '%can_view_shared%' then
      raise exception 'FAIL: % still has a guest branch', v_name;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'site_talk_signatures'
      and pol.polname = 'site_talk_signatures_select'
      and pg_get_expr(pol.polqual, pol.polrelid) not like '%can_view_shared%'
      and pg_get_expr(pol.polqual, pol.polrelid) like '%my_role()%'
  ) then
    raise exception 'FAIL: site_talk_signatures_select is missing the host branch';
  end if;
  raise notice 'ok: guest_signature_policy: site_talk_signatures_select has no guest branch';

  foreach v_role in array v_roles loop
    perform set_config('request.jwt.claim.sub', v_role::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_role::text, 'role', 'authenticated')::text,
      true
    );
    execute 'set local role authenticated';
    foreach v_table in array v_tables loop
      execute format('select count(*) from public.%I', v_table) into v_count;
      if v_count <> 0 then
        raise exception 'FAIL: % read % rows from %', v_role, v_count, v_table;
      end if;
    end loop;
    execute 'select count(*) from storage.objects' into v_count;
    if v_count <> 0 then
      raise exception 'FAIL: % read % storage.objects rows', v_role, v_count;
    end if;
  end loop;

  perform set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222221', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', 'a2222222-2222-4222-8222-222222222221', 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
  raise notice 'ok: guest_direct_reads: guest owner, cm, and operative read 0 rows from every shared table and storage';
end
$guest_direct_reads$;

-- Probe guest_talk_host_only.
-- Assertion: guest owner, cm, and operative get 0 rows from signatures (including
-- signature_png), questions, notes, version body, pdf_path, and storage objects
-- under */talks/*, and not_authorized or no execute from talk_register and site_talk_detail.
do $guest_talk_host_only$
declare
  v_role uuid;
  v_roles uuid[] := array[
    'a2222222-2222-4222-8222-222222222221'::uuid,
    'a2222222-2222-4222-8222-222222222222'::uuid,
    'a2222222-2222-4222-8222-222222222223'::uuid
  ];
  v_site uuid := '51111111-1111-4111-8111-111111111111';
  v_talk uuid := 'cc111111-1111-4111-8111-111111111111';
  v_count bigint;
  v_text text;
  v_state text;
  v_extra text;
  v_pol text;
begin
  execute 'reset role';
  if (select count(*) from public.site_talk_signatures where signature_png like 'SIGIMAGE-SECRET%') <> 1
     or (select count(*) from public.site_talk_questions where body = 'QUESTION-SECRET') <> 1
     or (select count(*) from public.site_talk_notes where explained_verbally and interpreter_used) <> 1
     or (select count(*) from public.site_talk_versions where pdf_path like '%/talks/TALKPDF-SECRET.pdf' and body = 'Read this induction.') <> 1
     or (select count(*) from storage.objects where name like '%/talks/%') < 1
  then
    raise exception 'FAIL: host talk secrets are missing, so a guest leak would not show up';
  end if;

  select n.nspname || '.' || p.proname
  into v_extra
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosrc ilike '%talk_register(%'
    and not (n.nspname = 'public' and p.proname = 'site_talk_detail')
  limit 1;
  if v_extra is not null then
    raise exception 'FAIL: another function returns talk_register: %', v_extra;
  end if;

  foreach v_pol in array array[
    'site_talk_signatures_select',
    'site_talk_questions_select',
    'site_talk_notes_select',
    'site_talk_versions_select'
  ]
  loop
    select coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
    into v_text
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and pol.polname = v_pol;
    if v_text is null or v_text like '%can_view_shared%' then
      raise exception 'FAIL: % is missing or has a guest branch', v_pol;
    end if;
  end loop;

  foreach v_role in array v_roles loop
    perform set_config('request.jwt.claim.sub', v_role::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_role::text, 'role', 'authenticated')::text,
      true
    );
    execute 'set local role authenticated';

    select count(*) into v_count from public.site_talk_signatures;
    select coalesce(max(s.signature_png), '') into v_text from public.site_talk_signatures s;
    if v_count <> 0 or v_text <> '' or position('SIGIMAGE-SECRET' in v_text) > 0 then
      raise exception 'FAIL: % read signature rows', v_role;
    end if;
    -- signer_name is not granted, so the whole row is permission denied.
    -- A granted column still has to come back empty.
    begin
      select coalesce(max(to_jsonb(s)::text), '') into v_text from public.site_talk_signatures s;
      if v_text <> '' or position('signature_png' in v_text) > 0 or position('SIGIMAGE-SECRET' in v_text) > 0 then
        raise exception 'FAIL: % read a signature column', v_role;
      end if;
    exception
      when insufficient_privilege then
        null;
      when others then
        get stacked diagnostics v_state = returned_sqlstate;
        if v_state is distinct from '42501' or position('SIGIMAGE-SECRET' in sqlerrm) > 0 then
          raise exception 'FAIL: % signature row % %', v_role, v_state, sqlerrm;
        end if;
    end;

    select count(*) into v_count from public.site_talk_questions;
    select coalesce(max(q.body), '') into v_text from public.site_talk_questions q;
    if v_count <> 0 or position('QUESTION-SECRET' in v_text) > 0 then
      raise exception 'FAIL: % read questions', v_role;
    end if;

    select count(*) into v_count from public.site_talk_notes;
    if v_count <> 0 then
      raise exception 'FAIL: % read notes', v_role;
    end if;

    select count(*) into v_count from public.site_talk_versions;
    select coalesce(max(v.body), '') || coalesce(max(v.pdf_path), '') into v_text from public.site_talk_versions v;
    if v_count <> 0 or position('Read this induction' in v_text) > 0 or position('TALKPDF-SECRET' in v_text) > 0 or position('/talks/' in v_text) > 0 then
      raise exception 'FAIL: % read a version body or pdf_path', v_role;
    end if;

    select count(*) into v_count from storage.objects where name like '%/talks/%';
    if v_count <> 0 then
      raise exception 'FAIL: % read % talks storage objects', v_role, v_count;
    end if;

    begin
      perform private.talk_register(v_talk);
      raise exception 'FAIL: % talk_register returned rows', v_role;
    exception
      when insufficient_privilege then
        null;
      when others then
        get stacked diagnostics v_state = returned_sqlstate;
        if sqlerrm is distinct from 'not_authorized' or position('SIGIMAGE-SECRET' in sqlerrm) > 0 or position('QUESTION-SECRET' in sqlerrm) > 0 then
          raise exception 'FAIL: % talk_register % %', v_role, v_state, sqlerrm;
        end if;
    end;

    begin
      perform public.site_talk_detail(v_talk);
      raise exception 'FAIL: % site_talk_detail returned the register', v_role;
    exception
      when insufficient_privilege then
        null;
      when others then
        get stacked diagnostics v_state = returned_sqlstate;
        if (sqlerrm is distinct from 'not_authorized' and v_state is distinct from '42501')
           or position('SIGIMAGE-SECRET' in sqlerrm) > 0
           or position('QUESTION-SECRET' in sqlerrm) > 0
           or position('TALKPDF-SECRET' in sqlerrm) > 0
           or position('signature_png' in sqlerrm) > 0 then
          raise exception 'FAIL: % site_talk_detail % %', v_role, v_state, sqlerrm;
        end if;
    end;

    v_text := public.shared_induction_register(v_site)::text;
    if position('Łukasz Wójcik' in v_text) = 0
       or position('Firm X' in v_text) = 0
       or position('"status": "Signed"' in v_text) = 0
       or position('title' in v_text) > 0
       or position('meaning' in v_text) > 0
       or position('SIGIMAGE-SECRET' in v_text) > 0
       or position('QUESTION-SECRET' in v_text) > 0
       or position('TALKPDF-SECRET' in v_text) > 0
       or position('Read this induction' in v_text) > 0
       or position('/talks/' in v_text) > 0
       or position('signature_png' in v_text) > 0 then
      raise exception 'FAIL: % induction register is not name, company, time, and status: %', v_role, v_text;
    end if;
  end loop;

  raise notice 'ok: guest_talk_host_only: guest owner, cm, and operative get 0 rows or not_authorized from signatures, questions, notes, talk_register, version body, pdf_path, and talks files';
end
$guest_talk_host_only$;

-- Probe guest_signature_image.
-- Assertion: guest owner, cm, and operative get no signature image from a direct select or any rpc.
do $guest_signature_image$
declare
  v_role uuid;
  v_roles uuid[] := array[
    'a2222222-2222-4222-8222-222222222221'::uuid,
    'a2222222-2222-4222-8222-222222222222'::uuid,
    'a2222222-2222-4222-8222-222222222223'::uuid
  ];
  v_site uuid := '51111111-1111-4111-8111-111111111111';
  v_talk uuid := 'cc111111-1111-4111-8111-111111111111';
  v_png text;
  v_fn record;
  v_fill uuid;
  v_fills uuid[];
  v_args text;
  v_sql text;
  v_text text;
  v_calls integer := 0;
  v_state text;
begin
  execute 'reset role';
  select s.signature_png into v_png
  from public.site_talk_signatures s
  where s.person_name = 'Łukasz Wójcik';
  if v_png is null or position('SIGIMAGE-SECRET' in v_png) = 0 then
    raise exception 'FAIL: seeded signature image is missing';
  end if;

  foreach v_role in array v_roles loop
    perform set_config('request.jwt.claim.sub', v_role::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_role::text, 'role', 'authenticated')::text,
      true
    );
    execute 'set local role authenticated';

    if not has_column_privilege('authenticated', 'public.site_talk_signatures', 'signature_png', 'select') then
      raise exception 'FAIL: signature_png is not granted, so a policy leak would not show up';
    end if;

    -- The image column is granted. These roles still get no row, so the image
    -- stays behind the host policy rather than a missing column privilege.
    select coalesce(string_agg(s.signature_png, ''), '') into v_text
    from public.site_talk_signatures s;
    if v_text <> '' or position('SIGIMAGE-SECRET' in v_text) > 0 then
      raise exception 'FAIL: % direct select returned a signature image', v_role;
    end if;

    begin
      select coalesce(string_agg(to_jsonb(s)::text, ''), '') into v_text
      from public.site_talk_signatures s;
      if v_text <> '' or position('SIGIMAGE-SECRET' in v_text) > 0
         or position('"signature_png"' in v_text) > 0 then
        raise exception 'FAIL: % direct select returned a signature row', v_role;
      end if;
    exception
      when insufficient_privilege then
        null;
      when others then
        get stacked diagnostics v_state = returned_sqlstate;
        if v_state is distinct from '42501'
           or position('SIGIMAGE-SECRET' in sqlerrm) > 0
           or position('direct select returned' in sqlerrm) > 0 then
          raise exception 'FAIL: % signature row % %', v_role, v_state, sqlerrm;
        end if;
    end;

    if exists (select 1 from public.site_talk_signatures) then
      raise exception 'FAIL: % direct select returned signature rows', v_role;
    end if;

    v_text := public.shared_induction_register(v_site)::text;
    if position('Łukasz Wójcik' in coalesce(v_text, '')) = 0
       or position('SIGIMAGE-SECRET' in coalesce(v_text, '')) > 0
       or position('"signature_png"' in coalesce(v_text, '')) > 0 then
      raise exception 'FAIL: % induction register returned signature data', v_role;
    end if;

    v_fills := array[null::uuid, v_site, v_talk];
    foreach v_fill in array v_fills loop
      for v_fn in
        select p.proname, p.prokind, p.proargtypes
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prokind in ('f', 'p')
          and has_function_privilege('authenticated', p.oid, 'execute')
          and pg_catalog.pg_get_function_result(p.oid) not in ('trigger', 'event_trigger')
      loop
        select coalesce(string_agg(
          case
            when v_fill is not null and format_type(u.t, null) = 'uuid'
              then quote_literal(v_fill) || '::uuid'
            else 'null::' || format_type(u.t, null)
          end,
          ', ' order by u.ord
        ), '')
        into v_args
        from unnest(v_fn.proargtypes) with ordinality as u(t, ord);

        if v_fn.prokind = 'p' then
          v_sql := format('call public.%I(%s)', v_fn.proname, v_args);
        else
          v_sql := format('select t::text from public.%I(%s) as t', v_fn.proname, v_args);
        end if;

        -- Raising rolls this call back, so a write cannot change the rest of the probe.
        begin
          if v_fn.prokind = 'p' then
            execute v_sql;
          else
            for v_text in execute v_sql loop
              if position('SIGIMAGE-SECRET' in coalesce(v_text, '')) > 0
                 or position('"signature_png"' in coalesce(v_text, '')) > 0 then
                raise exception 'returned signature data in %', v_fn.proname;
              end if;
            end loop;
          end if;
          raise exception 'rollback_call';
        exception
          when others then
            get stacked diagnostics v_state = returned_sqlstate;
            if v_state in ('42601', '42883')
               or position('SIGIMAGE-SECRET' in sqlerrm) > 0
               or position('returned signature data' in sqlerrm) > 0 then
              raise exception 'FAIL: % as % -> %', v_fn.proname, v_role, sqlerrm;
            end if;
            v_calls := v_calls + 1;
        end;
      end loop;
    end loop;
  end loop;

  if v_calls < 100 then
    raise exception 'FAIL: signature rpc sweep only made % calls', v_calls;
  end if;

  perform set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222221', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', 'a2222222-2222-4222-8222-222222222221', 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
  raise notice 'ok: guest owner, cm, and operative get no signature image from a direct select or any rpc';
end
$guest_signature_image$;

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

select public.my_shared_sites();
select public.my_shared_sites();

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;
select public.revoke_site_share((select (v ->> 'share_id')::uuid from share_probe where k = 'redeemed'));

select pg_temp.ok(
  (select count(*) from public.site_share_audit where action = 'created') >= 1
  and (select count(*) from public.site_share_audit where action = 'redeemed') >= 1
  and (select count(*) from public.site_share_audit where action = 'sections_changed') >= 1
  and (select count(*) from public.site_share_audit where action = 'approved') >= 1
  and (select count(*) from public.site_share_audit where action = 'revoked') >= 1
  and (select count(*) from public.site_share_audit where action = 'view_granted') = 1,
  'create, redeem, approve, section change, revoke, and one view grant are audited'
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
  (pg_temp.redeem(:'ownery'::uuid, :'hashlook', null) ->> 'error') = 'invalid_input',
  'a lookalike company name returns the same error as a bad code'
);

select pg_temp.jwt(:'opy'::uuid);
select pg_temp.ok(
  (pg_temp.redeem(:'opy'::uuid, :'hashop', null) ->> 'error') = 'invalid_input',
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
  (pg_temp.redeem(:'ownery'::uuid, :'hashop', null) ->> 'site_id') = :'sitea',
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
    v_err := pg_temp.redeem('a2222222-2222-4222-8222-222222222221'::uuid, 'abcd', null) ->> 'error';
    if v_err is distinct from 'invalid_input' then
      raise exception 'FAIL: attempt % -> %', v_i, v_err;
    end if;
  end loop;
  v_err := pg_temp.redeem('a2222222-2222-4222-8222-222222222221'::uuid, 'abcd', null) ->> 'error';
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

reset role;
insert into public.site_share_attempts (actor_id, client_ip)
select :'ownerz'::uuid, private.ip_subject('203.0.113.9')
from generate_series(1, 40);

do $ip$
declare
  v_err text;
  v_count integer;
begin
  perform set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333331', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', 'a3333333-3333-4333-8333-333333333331', 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
  v_err := pg_temp.redeem('a3333333-3333-4333-8333-333333333331'::uuid, 'abcd', '203.0.113.9') ->> 'error';
  execute 'reset role';
  select count(*) into v_count
  from public.site_share_attempts
  where client_ip = private.ip_subject('203.0.113.9');
  if v_err is distinct from 'too_many_attempts' or v_count <> 40 then
    raise exception 'FAIL: ip limit err % count %', v_err, v_count;
  end if;
  raise notice 'ok: an ip that already failed forty times is refused without another row';
end
$ip$;

reset role;
select pg_temp.ok(
  position(
    'pg_advisory_xact_lock(pg_catalog.hashtext(v_actor.person_id::text)'
    in pg_get_functiondef('public.redeem_site_share(uuid,text,text)'::regprocedure)
  ) > 0
  and position(
    'share-ip:'
    in pg_get_functiondef('public.redeem_site_share(uuid,text,text)'::regprocedure)
  ) > 0
  and position(
    'pg_advisory_xact_lock(pg_catalog.hashtext(v_actor.person_id::text)'
    in pg_get_functiondef('public.preview_site_share(uuid,text,text)'::regprocedure)
  ) > 0,
  'the redeem lock is hashtext of the person id'
);

do $rename$
declare
  v_redeem jsonb;
  v_row jsonb;
  v_notice jsonb;
  v_sql text;
  v_site uuid := '51111111-1111-4111-8111-111111111111';
  v_firm uuid := 'c3333333-3333-4333-8333-333333333333';
  v_calls text[] := array[
    'shared_site_view',
    'shared_drawings',
    'shared_variations',
    'shared_snags',
    'shared_sign_in_register',
    'shared_induction_register'
  ];
  v_count bigint;
begin
  execute 'reset role';
  delete from public.site_share_attempts where actor_id = 'a3333333-3333-4333-8333-333333333331';
  update public.companies set name = 'invited builders' where id = v_firm;

  perform set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333331', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', 'a3333333-3333-4333-8333-333333333331', 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
  v_redeem := pg_temp.redeem('a3333333-3333-4333-8333-333333333331'::uuid, '1212121212121212121212121212121212121212121212121212121212121212', null);
  if (v_redeem ->> 'status') is distinct from 'pending' then
    raise exception 'FAIL: rename redeem %', v_redeem;
  end if;
  begin
    perform public.shared_drawings(v_site);
    raise exception 'FAIL: pending rename share returned drawings';
  exception
    when others then
      if sqlerrm is distinct from 'not_shared' and position('pending rename share returned' in sqlerrm) = 0 then
        raise exception 'FAIL: pending rename drawings -> %', sqlerrm;
      end if;
      if position('pending rename share returned' in sqlerrm) > 0 then
        raise exception '%', sqlerrm;
      end if;
  end;
  if (select count(*) from public.drawings) <> 0 or (select count(*) from public.sites where id = v_site) <> 0 then
    raise exception 'FAIL: pending rename saw table rows';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', 'a1111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
  select row into v_row
  from jsonb_array_elements(public.list_site_shares(v_site) -> 'shares') row
  where row ->> 'guest_company_id' = v_firm::text;
  select row into v_notice
  from jsonb_array_elements(public.my_share_notices()) row
  where row ->> 'share_id' = v_row ->> 'id';
  if v_row ->> 'guest_company_name' is distinct from 'invited builders'
     or v_row ->> 'guest_company_id' is distinct from v_firm::text
     or v_row ->> 'redeemer_name' is distinct from 'Owner Z'
     or v_row ->> 'redeemer_email' is distinct from 'ownerz@firmz.test'
     or v_row ->> 'renamed' is distinct from 'false'
     or v_row ->> 'status' is distinct from 'pending'
     or v_notice ->> 'guest_company_name' is distinct from 'invited builders'
     or v_notice ->> 'redeemer_email' is distinct from 'ownerz@firmz.test'
  then
    raise exception 'FAIL: pinned identity % notice %', v_row, v_notice;
  end if;

  execute 'reset role';
  update public.companies set name = 'Firm Z Again' where id = v_firm;
  execute 'set local role authenticated';
  select row into v_row
  from jsonb_array_elements(public.list_site_shares(v_site) -> 'shares') row
  where row ->> 'guest_company_id' = v_firm::text;
  if v_row ->> 'renamed' is distinct from 'true'
     or v_row ->> 'current_company_name' is distinct from 'Firm Z Again'
     or v_row ->> 'guest_company_name' is distinct from 'invited builders'
  then
    raise exception 'FAIL: rename flag %', v_row;
  end if;
  raise notice 'ok: a renamed firm gets a pending share and the host sees the pinned identity';

  perform public.decline_site_share((v_row ->> 'id')::uuid);

  perform set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333331', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', 'a3333333-3333-4333-8333-333333333331', 'role', 'authenticated')::text,
    true
  );
  foreach v_sql in array v_calls loop
    begin
      execute format('select public.%I($1)', v_sql) using v_site;
      raise exception 'FAIL: declined % returned data', v_sql;
    exception
      when others then
        if sqlerrm is distinct from 'not_shared' and position('declined' in sqlerrm) = 0 then
          raise exception 'FAIL: declined % -> %', v_sql, sqlerrm;
        end if;
        if position('declined' in sqlerrm) > 0 and sqlerrm is distinct from 'not_shared' then
          raise exception '%', sqlerrm;
        end if;
    end;
  end loop;
  if position(v_site::text in public.my_shared_sites()::text) > 0 then
    raise exception 'FAIL: declined share is listed';
  end if;
  if (select count(*) from public.drawings) <> 0
     or (select count(*) from public.variations) <> 0
     or (select count(*) from public.snags) <> 0
     or (select count(*) from public.sites where id = v_site) <> 0
     or (select count(*) from public.site_talk_signatures) <> 0
     or (select count(*) from public.site_attendance) <> 0
  then
    raise exception 'FAIL: declined share still has table rows';
  end if;
  select count(*) into v_count from storage.objects;
  if v_count <> 0 then
    raise exception 'FAIL: declined share saw storage rows';
  end if;
  raise notice 'ok: pending and declined shares grant no rpc and no table rows';

  execute 'reset role';
  update public.companies set name = 'Firm Z' where id = v_firm;
end
$rename$;

reset role;
select pg_temp.ok(
  not has_function_privilege('authenticated', 'public.preview_site_share(uuid,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.redeem_site_share(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.preview_site_share(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.redeem_site_share(uuid,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.preview_site_share(uuid,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.redeem_site_share(uuid,text,text)', 'execute')
  and to_regprocedure('public.preview_site_share(text,text)') is null
  and to_regprocedure('public.redeem_site_share(text,text)') is null,
  'authenticated has no execute on preview or redeem'
);

-- Execute is not enough. Authenticated claims, and no claims, still raise.
do $service_gate$
declare
  v_user uuid := 'a1111111-1111-4111-8111-111111111111';
  v_hash text := '9999999999999999999999999999999999999999999999999999999999999999';
  v_fn text;
  v_msg text;
  v_pair text[];
  v_cases text[] := array[
    array['authenticated claims', '{"role":"authenticated"}', 'authenticated'],
    array['no claims', '', '']
  ];
begin
  foreach v_pair slice 1 in array v_cases loop
    execute 'reset role';
    perform set_config('request.jwt.claims', v_pair[2], true);
    perform set_config('request.jwt.claim.role', v_pair[3], true);
    perform set_config('request.jwt.claim.sub', '', true);
    execute 'set local role service_role';
    foreach v_fn in array array['preview_site_share', 'redeem_site_share'] loop
      v_msg := 'returned';
      begin
        execute format('select public.%I($1, $2, $3)', v_fn) using v_user, v_hash, '198.51.100.50';
      exception
        when others then
          v_msg := sqlerrm;
      end;
      if v_msg is distinct from 'not_authorized' then
        raise exception 'FAIL: % with % -> %', v_fn, v_pair[1], v_msg;
      end if;
    end loop;
  end loop;
  execute 'reset role';
  raise notice 'ok: preview and redeem raise not_authorized for authenticated claims and for no claims';
end
$service_gate$;

do $spoof$
declare
  v_i integer;
  v_before integer;
  v_after integer;
  v_redeem jsonb;
  v_state text;
  v_victim uuid := 'a2222222-2222-4222-8222-222222222222';
  v_claimed text := '203.0.113.77';
  v_hash text := 'efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef';
begin
  execute 'reset role';
  select count(*) into v_before
  from public.site_share_attempts
  where client_ip = private.ip_subject(v_claimed);

  perform set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333331', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', 'a3333333-3333-4333-8333-333333333331', 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  for v_i in 1..40 loop
    begin
      perform public.redeem_site_share(v_victim, 'abcd', v_claimed);
      raise exception 'FAIL: authenticated redeem ran';
    exception
      when insufficient_privilege then
        null;
      when others then
        get stacked diagnostics v_state = returned_sqlstate;
        if v_state is distinct from '42501' or position('authenticated redeem ran' in sqlerrm) > 0 then
          raise exception 'FAIL: spoof redeem % %', v_state, sqlerrm;
        end if;
    end;
    begin
      perform public.preview_site_share(v_victim, 'abcd', v_claimed);
      raise exception 'FAIL: authenticated preview ran';
    exception
      when insufficient_privilege then
        null;
      when others then
        get stacked diagnostics v_state = returned_sqlstate;
        if v_state is distinct from '42501' or position('authenticated preview ran' in sqlerrm) > 0 then
          raise exception 'FAIL: spoof preview % %', v_state, sqlerrm;
        end if;
    end;
  end loop;

  execute 'reset role';
  select count(*) into v_after
  from public.site_share_attempts
  where client_ip = private.ip_subject(v_claimed);
  if v_after <> v_before then
    raise exception 'FAIL: forged calls wrote % rows', v_after - v_before;
  end if;

  insert into public.site_share_attempts (actor_id, client_ip)
  select 'a3333333-3333-4333-8333-333333333331'::uuid, private.ip_subject(v_claimed)
  from generate_series(1, 40);

  perform set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', 'a1111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
  perform public.create_site_share_invite(
    '51111111-1111-4111-8111-111111111112'::uuid,
    'Firm Y',
    true, false, false, false, false,
    v_hash
  );
  execute 'reset role';

  v_redeem := pg_temp.redeem(v_victim, v_hash, '198.51.100.77');
  if (v_redeem ->> 'error') is not null
     or (v_redeem ->> 'site_id') is distinct from '51111111-1111-4111-8111-111111111112'
     or (v_redeem ->> 'status') is distinct from 'pending'
  then
    raise exception 'FAIL: valid redeem blocked by a claimed ip %', v_redeem;
  end if;
  raise notice 'ok: forty failures claiming another ip do not block a valid redeem';
end
$spoof$;

