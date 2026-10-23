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

create temp table probe (k text primary key, v jsonb);
grant all on table probe to authenticated;

select pg_temp.ok(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_site_talk',
        'revise_site_talk',
        'sign_site_talk',
        'ask_site_talk',
        'set_talk_person_note',
        'sign_talk_presenter',
        'list_site_talks',
        'my_outstanding_talks',
        'site_talk_detail',
        'talk_meaning_line',
        'induction_sign_in_gaps',
        'my_talk_badges'
      )
      and p.prosecdef
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
        where c like 'search_path=%'
      )
  ) = 12,
  'talk functions are security definer and pin search_path'
);

select pg_temp.ok(
  not has_function_privilege('anon', 'public.create_site_talk(uuid,text,text,text,text,text,text,uuid[],text,text,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.sign_site_talk(uuid,uuid,uuid,boolean,text,timestamptz,text)', 'execute')
  and not has_function_privilege('anon', 'public.ask_site_talk(uuid,uuid,uuid,text,timestamptz,text)', 'execute')
  and not has_function_privilege('anon', 'public.site_talk_detail(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.my_talk_badges()', 'execute')
  and not has_function_privilege('anon', 'public.induction_sign_in_gaps(uuid)', 'execute')
  and not has_function_privilege('public', 'public.sign_site_talk(uuid,uuid,uuid,boolean,text,timestamptz,text)', 'execute')
  and not has_function_privilege('anon', 'private.talk_actor()', 'execute')
  and not has_function_privilege('anon', 'private.talk_meaning(text,text,text,text,text,text,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'private.talk_meaning(text,text,text,text,text,text,timestamptz)', 'execute')
  and not has_table_privilege('anon', 'public.site_talks', 'select')
  and not has_table_privilege('anon', 'public.site_talk_signatures', 'select')
  and not has_table_privilege('authenticated', 'public.site_talks', 'insert')
  and not has_table_privilege('authenticated', 'public.site_talk_signatures', 'insert')
  and not has_table_privilege('authenticated', 'public.site_talk_signatures', 'update'),
  'anon cannot call and clients cannot write the tables directly'
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
    'Priya Shah',
    'Contracts manager',
    timestamptz '2026-10-22 12:00:00+00'
  )
);

select pg_temp.ok(
  (select v->>'content_hash' is not null from probe where k = 'inperson'),
  'an in-person toolbox talk accepts a talks/ PDF path'
);

reset role;
update public.site_talks
set presenter_person_id = :'opa'::uuid
where id = (select (v->>'talk_id')::uuid from probe where k = 'inperson');

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

update public.site_talks
set presenter_person_id = :'ownerx'::uuid
where id = (select (v->>'talk_id')::uuid from probe where k = 'inperson');

select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

insert into probe (k, v)
values (
  'presenter-sign',
  public.sign_talk_presenter(
    (select (v->>'talk_id')::uuid from probe where k = 'inperson'),
    (select (v->>'version_id')::uuid from probe where k = 'inperson'),
    :'png',
    timestamptz '2026-10-22 12:05:00+00',
    'session-owner-1'
  )
);

select pg_temp.ok(
  (select v->>'meaning' = 'I gave this talk to the people listed.' from probe where k = 'presenter-sign'),
  'the presenter sign-off stores its own sentence'
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
set local role anon;

select pg_temp.ok(
  pg_temp.raises('select public.my_talk_badges()', 'permission denied for function my_talk_badges')
  and pg_temp.raises('select public.create_site_talk(null, null, null, null, null, null, null, null, null, null, null)', 'permission denied for function create_site_talk')
  and pg_temp.raises('select public.sign_site_talk(null, null, null, null, null, null, null)', 'permission denied for function sign_site_talk')
  and pg_temp.raises('select public.site_talk_detail(null)', 'permission denied for function site_talk_detail'),
  'anon cannot call the talk functions'
);

reset role;

rollback;
