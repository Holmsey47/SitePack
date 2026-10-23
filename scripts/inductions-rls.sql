-- Induction RLS. Apply scripts/throwaway-auth.sql and every migration first.
--   DATABASE_URL=postgres://postgres@127.0.0.1/sitepack_talks bash scripts/run-inductions-rls.sh
-- The checks roll back. Nothing here is a hosted project.

\set ON_ERROR_STOP on
\set firmx 'c1111111-1111-4111-8111-111111111111'
\set firmy 'c2222222-2222-4222-8222-222222222222'
\set ownerx 'a1111111-1111-4111-8111-111111111111'
\set cmx 'a1111111-1111-4111-8111-111111111112'
\set opa 'a1111111-1111-4111-8111-111111111113'
\set opb 'a1111111-1111-4111-8111-111111111114'
\set opc 'a1111111-1111-4111-8111-111111111115'
\set opd 'a1111111-1111-4111-8111-111111111116'
\set ope 'a1111111-1111-4111-8111-111111111117'
\set opf 'a1111111-1111-4111-8111-111111111118'
\set ownery 'a2222222-2222-4222-8222-222222222221'
\set sitea '51111111-1111-4111-8111-111111111111'
\set siteb '51111111-1111-4111-8111-111111111112'
\set sitey '52222222-2222-4222-8222-222222222221'
\set png 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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

create or replace function pg_temp.keep_talk(
  p_name text,
  p_owner uuid,
  p_bucket text default 'drawings',
  p_mime text default 'application/pdf',
  p_size bigint default 2400,
  p_owner_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values (p_bucket, p_name, p_owner, p_owner_id, jsonb_build_object('mimetype', p_mime, 'size', p_size));
end;
$$;

create temp table probe (k text primary key, v jsonb);
grant all on table probe to authenticated;

create temp table new_talk_funcs as
select
  n.nspname as schema_name,
  p.proname as func_name,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  p.oid,
  p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and not exists (
    select 1
    from public.probe_funcs_before b
    where b.schema_name = n.nspname
      and b.func_name = p.proname
      and b.identity_args = pg_get_function_identity_arguments(p.oid)
  );

select pg_temp.ok(
  (select count(*) from new_talk_funcs) = :talk_func_count
  and (select count(*) from new_talk_funcs where schema_name = 'public') = :talk_public_count
  and (select count(*) from new_talk_funcs where schema_name = 'private') = :talk_private_count
  and not exists (
    select 1
    from new_talk_funcs f
    where not exists (
      select 1
      from unnest(coalesce(f.proconfig, array[]::text[])) c
      where c in ('search_path=""', 'search_path=')
    )
  )
  and not exists (
    select 1
    from new_talk_funcs f
    where has_function_privilege('anon', f.oid, 'execute')
       or has_function_privilege('public', f.oid, 'execute')
  )
  and not exists (
    select 1
    from new_talk_funcs f
    where f.schema_name = 'private'
      and has_function_privilege('authenticated', f.oid, 'execute')
  ),
  'every new function pins an empty search_path and anon and public cannot execute it'
);

select pg_temp.ok(
  not has_table_privilege('anon', 'public.site_talks', 'select')
  and not has_table_privilege('anon', 'public.site_talk_signatures', 'select')
  and not has_table_privilege('authenticated', 'public.site_talks', 'insert')
  and not has_table_privilege('authenticated', 'public.site_talk_signatures', 'insert')
  and not has_table_privilege('authenticated', 'public.site_talk_signatures', 'update'),
  'anon cannot read and clients cannot write the tables directly'
);

select pg_temp.ok(
  private.talk_meaning('induction', 'phone', 'attendee', 'Site A', 'Ignored', 'Owner X', timestamptz '2026-10-22 12:00:00+00')
    = 'I''ve read and understood the site induction for Site A and I''ll follow it. If anything''s unclear, I''ll ask the site manager before starting work.'
  and private.talk_meaning('toolbox', 'phone', 'attendee', 'Site A', 'Morning brief', 'Owner X', timestamptz '2026-10-22 12:00:00+00')
    = 'I''ve read and understood the toolbox talk ''Morning brief'' for Site A.'
  and private.talk_meaning('toolbox', 'in_person', 'attendee', 'Site A', 'Morning brief', 'Priya Shah', timestamptz '2026-10-22 12:00:00+00')
    = 'I was at the toolbox talk ''Morning brief'' given by Priya Shah at Site A on 22 Oct 2026, and I understood it.'
  and private.talk_meaning('toolbox', 'in_person', 'presenter', 'Site A', 'Morning brief', 'Priya Shah', timestamptz '2026-10-22 12:00:00+00')
    = 'I gave this talk to the people listed.'
  and private.talk_uk_date(timestamptz '2026-10-22 12:00:00+00') = '22 Oct 2026',
  'the server wording matches the legal sentences'
);

insert into auth.users (id, email)
values
  (:'ownerx', 'ownerx@firmx.test'),
  (:'cmx', 'cmx@firmx.test'),
  (:'opa', 'opa@firmx.test'),
  (:'opb', 'opb@firmx.test'),
  (:'opc', 'opc@firmx.test'),
  (:'opd', 'opd@firmx.test'),
  (:'ope', 'ope@firmx.test'),
  (:'opf', 'opf@firmx.test'),
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
  (:'opd', :'opd', :'firmx', 'operative', 'Op D', 'opd@firmx.test', 'labourer'),
  (:'ope', :'ope', :'firmx', 'operative', 'Op E', 'ope@firmx.test', 'labourer'),
  (:'opf', :'opf', :'firmx', 'operative', 'Op F', 'opf@firmx.test', 'labourer'),
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
  (:'sitea', :'opd'),
  (:'sitea', :'ope'),
  (:'sitea', :'opf'),
  (:'siteb', :'opb');

select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'', ''Body'', ''../secret.pdf'', ''all'', array[]::uuid[], ''Owner X'', ''Owner'', now())',
    'invalid_path'
  )
  and pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'', ''Body'', ''/etc/passwd'', ''all'', array[]::uuid[], ''Owner X'', ''Owner'', now())',
    'invalid_path'
  )
  and pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'', ''Body'', '
      || quote_literal(:'firmy') || ' || ''/'' || ' || quote_literal(:'sitea') || ' || ''/talks/a.pdf'', ''all'', array[]::uuid[], ''Owner X'', ''Owner'', now())',
    'invalid_path'
  ),
  'a PDF path with .., a leading slash, or the wrong company is rejected'
);

select pg_temp.keep_talk(:'firmx' || '/' || :'sitea' || '/talks/stolen.pdf', :'opa'::uuid);
select pg_temp.keep_talk(:'firmx' || '/' || :'sitea' || '/talks/bucket.pdf', :'ownerx'::uuid, 'site-photos');
select pg_temp.keep_talk(:'firmx' || '/' || :'sitea' || '/talks/photo.pdf', :'ownerx'::uuid, 'drawings', 'image/jpeg', 800);
select pg_temp.keep_talk(:'firmx' || '/' || :'sitea' || '/talks/huge.pdf', :'ownerx'::uuid, 'drawings', 'application/pdf', 52428801);
select pg_temp.keep_talk(:'firmx' || '/' || :'sitea' || '/talks/ownerid.pdf', null, 'drawings', 'application/pdf', 1800, :'ownerx');

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'', ''Body'', '
      || quote_literal(:'firmx' || '/' || :'sitea' || '/talks/missing.pdf')
      || ', ''all'', array[]::uuid[], ''Owner X'', ''Owner'', now())',
    'invalid_path'
  )
  and pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'', ''Body'', '
      || quote_literal(:'firmx' || '/' || :'sitea' || '/talks/brief.pdf/extra.pdf')
      || ', ''all'', array[]::uuid[], ''Owner X'', ''Owner'', now())',
    'invalid_path'
  )
  and pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'', ''Body'', '
      || quote_literal(:'firmx' || '/' || :'sitea' || '/talks-extra/a.pdf')
      || ', ''all'', array[]::uuid[], ''Owner X'', ''Owner'', now())',
    'invalid_path'
  )
  and pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'', ''Body'', '
      || quote_literal(:'firmx' || '/' || :'sitea' || '/talks/a file.pdf')
      || ', ''all'', array[]::uuid[], ''Owner X'', ''Owner'', now())',
    'invalid_path'
  )
  and pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'', ''Body'', '
      || quote_literal(:'firmx' || '//' || :'sitea' || '/talks/a.pdf')
      || ', ''all'', array[]::uuid[], ''Owner X'', ''Owner'', now())',
    'invalid_path'
  )
  and pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'', ''Body'', '
      || quote_literal(:'firmx' || '/' || :'sitea' || '/talks/stolen.pdf')
      || ', ''all'', array[]::uuid[], ''Owner X'', ''Owner'', now())',
    'invalid_path'
  )
  and pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'', ''Body'', '
      || quote_literal(:'firmx' || '/' || :'sitea' || '/talks/bucket.pdf')
      || ', ''all'', array[]::uuid[], ''Owner X'', ''Owner'', now())',
    'invalid_path'
  )
  and pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'', ''Body'', '
      || quote_literal(:'firmx' || '/' || :'sitea' || '/talks/photo.pdf')
      || ', ''all'', array[]::uuid[], ''Owner X'', ''Owner'', now())',
    'invalid_input'
  )
  and pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'', ''Body'', '
      || quote_literal(:'firmx' || '/' || :'sitea' || '/talks/huge.pdf')
      || ', ''all'', array[]::uuid[], ''Owner X'', ''Owner'', now())',
    'invalid_input'
  )
  and pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'' || chr(10) || ''line'', ''Body'', null, ''all'', array[]::uuid[], ''Owner X'', ''Owner'', now())',
    'invalid_input'
  )
  and pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'', ''Body'', null, ''all'', array[]::uuid[], ''Owner'' || chr(127), ''Owner'', now())',
    'invalid_input'
  )
  and pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''induction'', ''phone'', ''Bad'', ''Body'', null, ''all'', array[]::uuid[], ''Own'' || chr(1) || ''er'', ''Owner'', now())',
    'invalid_input'
  ),
  'a talk file must be this caller''s object at company/site/talks/file, and names reject control characters'
);

insert into probe (k, v)
values (
  'pdf',
  public.create_site_talk(
    :'sitea'::uuid,
    'toolbox',
    'phone',
    'Stored file',
    'Read the file.',
    :'firmx' || '/' || :'sitea' || '/talks/ownerid.pdf',
    'all',
    array[]::uuid[],
    'Owner X',
    'Owner',
    timestamptz '2026-10-22 12:00:00+00'
  )
);

select pg_temp.ok(
  (select pdf_content_type = 'application/pdf' and pdf_size_bytes = 1800 and pdf_path = :'firmx' || '/' || :'sitea' || '/talks/ownerid.pdf'
   from public.site_talk_versions
   where id = (select (v->>'version_id')::uuid from probe where k = 'pdf')),
  'mime type and size come from the stored object'
);

insert into probe (k, v)
values (
  'created',
  public.create_site_talk(
    :'sitea'::uuid,
    'induction',
    'phone',
    'Site induction',
    'Muster at the gate.',
    null,
    'all',
    array[]::uuid[],
    'Owner X',
    'Owner',
    timestamptz '2026-10-22 12:00:00+00'
  )
);

select pg_temp.ok(
  (select v->>'version_no' = '1' from probe where k = 'created'),
  'the owner can create an induction'
);

reset role;
select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''toolbox'', ''phone'', ''Nope'', ''Body'', null, ''all'', array[]::uuid[], ''Op A'', ''Op'', now())',
    'not_authorized'
  )
  and pg_temp.raises(
    'insert into public.site_talks (site_id, company_id, kind, delivery, title, audience, presenter_person_id, presenter_name, presenter_role, presented_at, created_by) values ('
      || quote_literal(:'sitea') || '::uuid, ' || quote_literal(:'firmx') || '::uuid, ''induction'', ''phone'', ''X'', ''all'', '
      || quote_literal(:'opa') || '::uuid, ''Op A'', ''Op'', now(), ' || quote_literal(:'opa') || '::uuid)',
    'permission denied for table site_talks'
  ),
  'an operative cannot create or edit a talk'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_site_talk('
      || quote_literal((select v->>'talk_id' from probe where k = 'created')) || '::uuid, '
      || quote_literal((select v->>'version_id' from probe where k = 'created')) || '::uuid, '
      || quote_literal(:'opc') || '::uuid, true, ' || quote_literal(:'png') || ', now(), ''session-probe-1'')',
    'not_authorized'
  ),
  'an operative cannot sign as someone else'
);

insert into probe (k, v)
values (
  'a-sign',
  public.sign_site_talk(
    (select (v->>'talk_id')::uuid from probe where k = 'created'),
    (select (v->>'version_id')::uuid from probe where k = 'created'),
    :'opa'::uuid,
    true,
    :'png',
    now() - interval '11 minutes',
    'session-probe-1'
  )
);

select pg_temp.ok(
  (select v->>'shared_device' = 'false'
      and v->>'meaning' = 'I''ve read and understood the site induction for Site A and I''ll follow it. If anything''s unclear, I''ll ask the site manager before starting work.'
      and v->>'received_at' is distinct from v->>'device_at'
      and v->>'captured_by' = :'opa'
   from probe where k = 'a-sign'),
  'a signature stores the server sentence, the device time, and the server time'
);

select pg_temp.ok(
  (select register is null
   from jsonb_to_record(public.site_talk_detail((select (v->>'talk_id')::uuid from probe where k = 'created')))
     as detail(register jsonb)),
  'the register is null for an operative'
);

select pg_temp.ok(
  (select count(*) from public.site_talk_signatures) = 1,
  'an operative cannot read other people''s signatures'
);

reset role;
select pg_temp.jwt(:'opb'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.site_talks) = 0
  and (select count(*) from public.site_talk_signatures) = 0
  and pg_temp.raises(
    'select public.list_site_talks(' || quote_literal(:'sitea') || '::uuid)',
    'not_authorized'
  ),
  'operative of site B cannot read site A'
);

reset role;
select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.site_talks) = 0
  and (select count(*) from public.site_talk_signatures) = 0
  and pg_temp.raises(
    'select public.site_talk_detail(' || quote_literal((select v->>'talk_id' from probe where k = 'created')) || '::uuid)',
    'not_authorized'
  ),
  'firm Y cannot read firm X'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

insert into probe (k, v)
values (
  'd-sign',
  public.sign_site_talk(
    (select (v->>'talk_id')::uuid from probe where k = 'created'),
    (select (v->>'version_id')::uuid from probe where k = 'created'),
    :'opd'::uuid,
    true,
    :'png',
    now(),
    'session-owner-1'
  )
),
(
  'e-sign',
  public.sign_site_talk(
    (select (v->>'talk_id')::uuid from probe where k = 'created'),
    (select (v->>'version_id')::uuid from probe where k = 'created'),
    :'ope'::uuid,
    true,
    :'png',
    now(),
    'session-owner-1'
  )
);

select pg_temp.ok(
  (select (v->>'shared_device')::boolean
      and v->>'captured_by' = :'ownerx'
      and v->>'session_id' = 'session-owner-1'
   from probe where k = 'd-sign'),
  'a shared-device signature records the signer, the login, and the session'
);

select pg_temp.ok(
  (public.ask_site_talk(
    (select (v->>'talk_id')::uuid from probe where k = 'created'),
    (select (v->>'version_id')::uuid from probe where k = 'created'),
    :'opc'::uuid,
    'Where is the muster point?',
    now(),
    'session-owner-1'
  ) ->> 'question_id') is not null,
  'a question is stored and does not sign'
);

select pg_temp.ok(
  (public.set_talk_person_note(
    (select (v->>'talk_id')::uuid from probe where k = 'created'),
    :'opd'::uuid,
    true,
    true
  ) ->> 'explained_verbally')::boolean,
  'the presenter can mark explained verbally and interpreter used'
);

insert into probe (k, v)
values (
  'detail',
  public.site_talk_detail((select (v->>'talk_id')::uuid from probe where k = 'created'))
);

select pg_temp.ok(
  (select (v->'register'->>'signed_count')::int = 3
      and (v->'register'->>'required_count')::int = 5
      and (select count(*) from jsonb_array_elements(v->'register'->'signed') s where s->>'person_name' in ('Op A', 'Op D', 'Op E')) = 3
      and (select count(*) from jsonb_array_elements(v->'register'->'not_signed') s) = 2
      and (select s->>'has_question' from jsonb_array_elements(v->'register'->'not_signed') s where s->>'person_name' = 'Op C') = 'true'
      and (select s->>'question' from jsonb_array_elements(v->'register'->'not_signed') s where s->>'person_name' = 'Op C') = 'Where is the muster point?'
      and (select (s->>'explained_verbally')::boolean and (s->>'interpreter_used')::boolean
           from jsonb_array_elements(v->'register'->'signed') s where s->>'person_name' = 'Op D')
      and (select (s->>'shared_device')::boolean from jsonb_array_elements(v->'register'->'signed') s where s->>'person_name' = 'Op D')
   from probe where k = 'detail'),
  'three of five are signed, with the question and the presenter marks'
);

insert into probe (k, v)
values (
  'revised',
  public.revise_site_talk(
    (select (v->>'talk_id')::uuid from probe where k = 'created'),
    'Site induction',
    'Muster by the cabin.',
    null
  )
);

select pg_temp.ok(
  (select (v->>'version_no')::int = 2
      and v->>'version_id' is distinct from (select p.v->>'version_id' from probe p where p.k = 'created')
   from probe where k = 'revised')
  and (select count(*) from public.site_talk_signatures s
       where s.version_id = (select (v->>'version_id')::uuid from probe where k = 'created')
         and s.signature_role = 'attendee') = 3
  and (select (public.site_talk_detail((select (v->>'talk_id')::uuid from probe where k = 'created'))->'register'->>'signed_count')::int) = 0
  and pg_temp.raises(
    'select public.sign_site_talk('
      || quote_literal((select v->>'talk_id' from probe where k = 'created')) || '::uuid, '
      || quote_literal((select v->>'version_id' from probe where k = 'created')) || '::uuid, '
      || quote_literal(:'opa') || '::uuid, true, ' || quote_literal(:'png') || ', now(), ''session-probe-1'')',
    'version_locked'
  ),
  'a changed body is a new version and the earlier signatures stay on the old one'
);

select pg_temp.keep_talk(:'firmx' || '/' || :'sitea' || '/talks/brief.pdf', :'ownerx'::uuid);

insert into probe (k, v)
values (
  'inperson',
  public.create_site_talk(
    :'sitea'::uuid,
    'toolbox',
    'in_person',
    'Morning brief',
    'Watch the leading edge.',
    :'firmx' || '/' || :'sitea' || '/talks/brief.pdf',
    'all',
    array[]::uuid[],
    'Op A',
    'Operative',
    timestamptz '2026-10-22 12:00:00+00'
  )
);

select pg_temp.ok(
  (select v->>'content_hash' is not null
      and v->>'presenter_person_id' = :'opa'
   from probe where k = 'inperson'),
  'an in-person toolbox talk accepts a talks/ PDF path and the named presenter is that person'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_site_talk('
      || quote_literal(:'sitea') || '::uuid, ''toolbox'', ''phone'', ''Again'', ''Body'', '
      || quote_literal(:'firmx' || '/' || :'sitea' || '/talks/brief.pdf')
      || ', ''all'', array[]::uuid[], ''Owner X'', ''Owner'', now())',
    'invalid_path'
  )
  and (select pdf_content_type = 'application/pdf' and pdf_size_bytes = 2400
       from public.site_talk_versions
       where id = (select (v->>'version_id')::uuid from probe where k = 'inperson')),
  'the same talk file cannot be recorded twice, and its type and size are the object''s'
);

update public.people set display_name = 'Op' || chr(10) || 'F' where id = :'opf'::uuid;

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_site_talk('
      || quote_literal((select v->>'talk_id' from probe where k = 'created')) || '::uuid, '
      || quote_literal((select v->>'version_id' from probe where k = 'revised')) || '::uuid, '
      || quote_literal(:'opf') || '::uuid, true, ' || quote_literal(:'png') || ', now(), ''session-owner-1'')',
    'invalid_input'
  ),
  'a signer name with a control character is rejected'
);

update public.people set display_name = 'Op F' where id = :'opf'::uuid;

insert into probe (k, v)
values (
  'sign-again-a',
  public.sign_site_talk(
    (select (v->>'talk_id')::uuid from probe where k = 'created'),
    (select (v->>'version_id')::uuid from probe where k = 'revised'),
    :'opa'::uuid,
    true,
    :'png',
    now(),
    'session-probe-1'
  )
);

insert into probe (k, v)
values (
  'sign-again-b',
  public.sign_site_talk(
    (select (v->>'talk_id')::uuid from probe where k = 'created'),
    (select (v->>'version_id')::uuid from probe where k = 'revised'),
    :'opa'::uuid,
    true,
    :'png',
    now(),
    'session-probe-1'
  )
);

select pg_temp.ok(
  (select v->>'signature_id' from probe where k = 'sign-again-a')
    = (select v->>'signature_id' from probe where k = 'sign-again-b')
  and (select count(*) from public.site_talk_signatures s
       where s.version_id = (select (v->>'version_id')::uuid from probe where k = 'revised')
         and s.person_id = :'opa'::uuid
         and s.signature_role = 'attendee') = 1,
  'a second sign of the same version returns the stored row'
);

select pg_temp.jwt(:'opc'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_site_talk('
      || quote_literal((select v->>'talk_id' from probe where k = 'inperson')) || '::uuid, '
      || quote_literal((select v->>'version_id' from probe where k = 'inperson')) || '::uuid, '
      || quote_literal(:'opf') || '::uuid, true, ' || quote_literal(:'png') || ', now(), ''session-opc-1'')',
    'not_authorized'
  ),
  'another operative still cannot sign for someone else'
);

reset role;
select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

insert into probe (k, v)
values (
  'presenter-capture',
  public.sign_site_talk(
    (select (v->>'talk_id')::uuid from probe where k = 'inperson'),
    (select (v->>'version_id')::uuid from probe where k = 'inperson'),
    :'opf'::uuid,
    true,
    :'png',
    now(),
    'session-presenter-1'
  )
);

select pg_temp.ok(
  (select (v->>'shared_device')::boolean and v->>'meaning' like 'I was at the toolbox talk ''Morning brief''%'
   from probe where k = 'presenter-capture'),
  'the presenter login can capture one other person on that talk'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

insert into probe (k, v)
values (
  'presenter-for',
  public.sign_talk_presenter(
    (select (v->>'talk_id')::uuid from probe where k = 'inperson'),
    (select (v->>'version_id')::uuid from probe where k = 'inperson'),
    :'png',
    timestamptz '2026-10-22 12:05:00+00',
    'session-owner-1'
  )
);

select pg_temp.ok(
  (select v->>'meaning' = 'signed by Owner X for Op A'
      and v->>'meaning' is distinct from 'I gave this talk to the people listed.'
   from probe where k = 'presenter-for')
  and (
    select s.meaning = 'signed by Owner X for Op A'
    from public.site_talk_signatures s
    where s.version_id = (select (v->>'version_id')::uuid from probe where k = 'inperson')
      and s.signature_role = 'presenter'
  ),
  'a manager signing for the named presenter is stored as signed by that manager'
);

insert into probe (k, v)
values (
  'presenter-own',
  public.create_site_talk(
    :'sitea'::uuid,
    'toolbox',
    'in_person',
    'Afternoon brief',
    'Watch the leading edge.',
    null,
    'all',
    array[]::uuid[],
    'Op A',
    'Operative',
    timestamptz '2026-10-22 12:00:00+00'
  )
);

reset role;
select pg_temp.jwt(:'opc'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_talk_presenter('
      || quote_literal((select v->>'talk_id' from probe where k = 'presenter-own')) || '::uuid, '
      || quote_literal((select v->>'version_id' from probe where k = 'presenter-own')) || '::uuid, '
      || quote_literal(:'png') || ', now(), ''session-opc-2'')',
    'not_authorized'
  ),
  'another operative cannot sign the presenter line'
);

reset role;
select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

insert into probe (k, v)
values (
  'presenter-sign',
  public.sign_talk_presenter(
    (select (v->>'talk_id')::uuid from probe where k = 'presenter-own'),
    (select (v->>'version_id')::uuid from probe where k = 'presenter-own'),
    :'png',
    timestamptz '2026-10-22 12:10:00+00',
    'session-opa-2'
  )
);

select pg_temp.ok(
  (select v->>'meaning' = 'I gave this talk to the people listed.' from probe where k = 'presenter-sign'),
  'the named presenter sign-off stores its own sentence'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

insert into probe (k, v)
values (
  'chosen',
  public.create_site_talk(
    :'sitea'::uuid,
    'toolbox',
    'phone',
    'Chosen only',
    'Chosen muster words.',
    null,
    'chosen',
    array[:'opa'::uuid],
    'Owner X',
    'Owner',
    timestamptz '2026-10-22 12:00:00+00'
  )
);

reset role;
select pg_temp.jwt(:'opc'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.site_talks where title = 'Chosen only') = 0
  and (select count(*) from public.site_talk_versions where body = 'Chosen muster words.') = 0
  and pg_temp.raises(
    'select public.site_talk_detail(' || quote_literal((select v->>'talk_id' from probe where k = 'chosen')) || '::uuid)',
    'not_authorized'
  ),
  'an operative who was not chosen cannot read that talk'
);

reset role;
select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select public.site_talk_detail((select (v->>'talk_id')::uuid from probe where k = 'chosen'))->>'body') = 'Chosen muster words.',
  'a chosen operative can read that talk'
);

reset role;
select pg_temp.jwt(:'opf'::uuid);
set local role authenticated;

select pg_temp.ok(
  public.sign_in_site(:'sitea'::uuid, now()) ->> 'state' = 'in',
  'site sign-in is not blocked when an induction is still unsigned'
);

reset role;
select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  public.induction_sign_in_gaps(:'sitea'::uuid) is null,
  'sign-in gaps are null for an operative'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from jsonb_array_elements(public.induction_sign_in_gaps(:'sitea'::uuid)) g where g->>'person_name' = 'Op F') = 1,
  'the owner can see who signed in without the induction'
);

reset role;
grant select on new_talk_funcs to anon;
set local role anon;

select pg_temp.ok(
  (
    select bool_and(
      pg_temp.raises(
        format(
          'select %I.%I(%s)',
          f.schema_name,
          f.func_name,
          case
            when f.identity_args = '' then ''
            else (
              select string_agg(
                'null::' || btrim(regexp_replace(btrim(part), '^[[:alpha:]_][[:alnum:]_]*[[:space:]]+', '')),
                ', '
              )
              from unnest(string_to_array(f.identity_args, ',')) part
            )
          end
        ),
        'permission denied for function ' || f.func_name
      )
    )
    from new_talk_funcs f
    where f.schema_name = 'public'
  )
  and (select count(*) from new_talk_funcs where schema_name = 'public') = :talk_public_count,
  'anon cannot call any new public function'
);

reset role;

rollback;
