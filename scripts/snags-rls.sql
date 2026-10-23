-- Snags RLS. Apply scripts/throwaway-auth.sql and every migration first.
--   DATABASE_URL=postgres://postgres@127.0.0.1/sitepack_snags bash scripts/run-snag-rls.sh
-- The checks roll back. Nothing here is a hosted project.

\set ON_ERROR_STOP on
\set firmx 'c1111111-1111-4111-8111-111111111111'
\set firmy 'c2222222-2222-4222-8222-222222222222'
\set ownerx 'a1111111-1111-4111-8111-111111111111'
\set cmx 'a1111111-1111-4111-8111-111111111112'
\set opa 'a1111111-1111-4111-8111-111111111113'
\set opb 'a1111111-1111-4111-8111-111111111114'
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

create or replace function pg_temp.one_photo(p_company uuid, p_site uuid, p_name text)
returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'storage_path', p_company::text || '/' || p_site::text || '/snags/' || p_name,
      'content_type', 'image/jpeg',
      'file_size_bytes', 1200
    )
  );
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
        'create_snag',
        'fix_snag',
        'sign_off_snags_internal',
        'sign_off_snags_contractor',
        'list_snags',
        'snag_detail',
        'snag_report',
        'snag_trade_labels'
      )
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
        where c like 'search_path=%'
      )
  ) = 8,
  'snag functions pin search_path'
);

select pg_temp.ok(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname in (
        'create_snag',
        'fix_snag',
        'sign_off_snags_internal',
        'sign_off_snags_contractor',
        'snag_trade_labels'
      )
  ) = 5
  and not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('list_snags', 'snag_detail', 'snag_report')
      and p.prosecdef
  ),
  'writes are security definer and snag reads run as the caller'
);

select pg_temp.ok(
  not has_function_privilege('anon', 'public.create_snag(uuid,uuid,text,text,text,timestamptz,jsonb)', 'execute')
  and not has_function_privilege('public', 'public.create_snag(uuid,uuid,text,text,text,timestamptz,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.fix_snag(uuid,timestamptz,jsonb)', 'execute')
  and not has_function_privilege('public', 'public.fix_snag(uuid,timestamptz,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.sign_off_snags_internal(uuid,uuid,timestamptz,text)', 'execute')
  and not has_function_privilege('public', 'public.sign_off_snags_internal(uuid,uuid,timestamptz,text)', 'execute')
  and not has_function_privilege('anon', 'public.sign_off_snags_contractor(uuid,uuid,timestamptz,text,text,text,text)', 'execute')
  and not has_function_privilege('public', 'public.sign_off_snags_contractor(uuid,uuid,timestamptz,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.list_snags(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.snag_detail(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.snag_report(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.snag_trade_labels(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.snag_confirmation(text,text)', 'execute')
  and not has_function_privilege('authenticated', 'private.snag_confirmation(text,text)', 'execute')
  and not has_function_privilege('anon', 'private.apply_snag_signoff(uuid,uuid,timestamptz,text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'private.snag_take_photos(uuid,uuid,uuid,text,jsonb)', 'execute')
  and not has_table_privilege('anon', 'public.snags', 'select')
  and not has_table_privilege('anon', 'public.snag_signoffs', 'select')
  and not has_table_privilege('authenticated', 'public.snags', 'insert')
  and not has_table_privilege('authenticated', 'public.snags', 'update')
  and not has_table_privilege('authenticated', 'public.snag_photos', 'insert')
  and not has_table_privilege('authenticated', 'public.snag_signatures', 'insert')
  and not has_table_privilege('authenticated', 'public.snag_signoffs', 'insert')
  and not has_table_privilege('authenticated', 'public.snag_signoffs', 'update'),
  'anon cannot call snags and clients cannot write the tables directly'
);

select pg_temp.ok(
  (
    select count(*)
    from pg_policies
    where policyname in (
      'snags_select',
      'snag_photos_select',
      'snag_signatures_select',
      'snag_signoffs_select',
      'snag_counters_select'
    )
  ) = 5,
  'snag RLS policies exist'
);

insert into auth.users (id, email)
values
  (:'ownerx', 'ownerx@firmx.test'),
  (:'cmx', 'cmx@firmx.test'),
  (:'opa', 'opa@firmx.test'),
  (:'opb', 'opb@firmx.test'),
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
  (:'siteb', :'opb');

insert into storage.objects (bucket_id, name)
values
  ('site-photos', :'firmx' || '/' || :'sitea' || '/snags/a.jpg'),
  ('site-photos', :'firmx' || '/' || :'siteb' || '/snags/b.jpg'),
  ('site-photos', :'firmy' || '/' || :'sitey' || '/snags/y.jpg');

select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_snag(gen_random_uuid(), '
      || quote_literal(:'sitea') || '::uuid, ''Hole'', null, ''dryliner'', now() + interval ''40 days'', '
      || 'pg_temp.one_photo(' || quote_literal(:'firmx') || '::uuid, ' || quote_literal(:'sitea') || '::uuid, ''late.jpg''))',
    'invalid_time'
  ),
  'a device time weeks ahead is rejected'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_snag(gen_random_uuid(), '
      || quote_literal(:'sitea') || '::uuid, ''Hole'', null, ''dryliner'', now() - interval ''40 days'', '
      || 'pg_temp.one_photo(' || quote_literal(:'firmx') || '::uuid, ' || quote_literal(:'sitea') || '::uuid, ''old.jpg''))',
    'invalid_time'
  ),
  'a device time older than 30 days is rejected'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_snag(gen_random_uuid(), '
      || quote_literal(:'siteb') || '::uuid, ''Nope'', null, ''dryliner'', now(), '
      || 'pg_temp.one_photo(' || quote_literal(:'firmx') || '::uuid, ' || quote_literal(:'siteb') || '::uuid, ''nope.jpg''))',
    'not_authorized'
  ),
  'operative of site A cannot raise a snag on site B'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_snag(gen_random_uuid(), '
      || quote_literal(:'sitea') || '::uuid, ''Bad'', null, ''dryliner'', now(), '
      || quote_literal(jsonb_build_array(jsonb_build_object(
           'storage_path', :'firmx' || '/' || :'sitea' || '/snags/../x.jpg',
           'content_type', 'image/jpeg',
           'file_size_bytes', 1200
         ))::text) || '::jsonb)',
    'invalid_path'
  ),
  'a snag photo path cannot contain ..'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_snag(gen_random_uuid(), '
      || quote_literal(:'sitea') || '::uuid, ''Bad'', null, ''dryliner'', now(), '
      || quote_literal(jsonb_build_array(jsonb_build_object(
           'storage_path', '/' || :'firmx' || '/' || :'sitea' || '/snags/x.jpg',
           'content_type', 'image/jpeg',
           'file_size_bytes', 1200
         ))::text) || '::jsonb)',
    'invalid_path'
  ),
  'a snag photo path cannot start with a slash'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_snag(gen_random_uuid(), '
      || quote_literal(:'sitea') || '::uuid, ''Bad'', null, ''dryliner'', now(), '
      || quote_literal(jsonb_build_array(jsonb_build_object(
           'storage_path', :'firmx' || '/' || :'sitea' || '/variations/x.jpg',
           'content_type', 'image/jpeg',
           'file_size_bytes', 1200
         ))::text) || '::jsonb)',
    'invalid_path'
  ),
  'a snag photo path has to stay under company/site/snags'
);

insert into probe (k, v)
values (
  'a',
  public.create_snag(
    gen_random_uuid(),
    :'sitea'::uuid,
    'Bead missing at the reveal',
    'Ground',
    'dryliner',
    now() - interval '3 hours',
    pg_temp.one_photo(:'firmx'::uuid, :'sitea'::uuid, 'a.jpg')
  )
);

select pg_temp.ok(
  (public.create_snag(
    (select (v->>'snag_id')::uuid from probe where k = 'a'),
    :'sitea'::uuid,
    'Bead missing at the reveal',
    'Ground',
    'dryliner',
    now() - interval '3 hours',
    pg_temp.one_photo(:'firmx'::uuid, :'sitea'::uuid, 'again.jpg')
  ) ->> 'snag_id') = (select v->>'snag_id' from probe where k = 'a')
  and (select count(*) from public.snags where id = (select (v->>'snag_id')::uuid from probe where k = 'a')) = 1
  and (select count(*) from public.snag_photos where snag_id = (select (v->>'snag_id')::uuid from probe where k = 'a')) = 1,
  'a retry of the same snag id does not create a duplicate'
);

select pg_temp.ok(
  (select raised_at = now() - interval '3 hours'
      and raised_received_at = now()
      and raised_at <> raised_received_at
      and status = 'Open'
      and raised_by_name = 'Op A'
   from public.snags
   where id = (select (v->>'snag_id')::uuid from probe where k = 'a')),
  'the device raised time is kept and received_at is the server clock'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.fix_snag('
      || quote_literal((select v->>'snag_id' from probe where k = 'a'))
      || '::uuid, now(), ''[]''::jsonb)',
    'photo_count'
  ),
  'marking fixed needs an after photo'
);

select public.fix_snag(
  (select (v->>'snag_id')::uuid from probe where k = 'a'),
  now() - interval '1 hour',
  pg_temp.one_photo(:'firmx'::uuid, :'sitea'::uuid, 'a-after.jpg')
);

select pg_temp.ok(
  (select status = 'Fixed'
      and fixed_at = now() - interval '1 hour'
      and fixed_received_at = now()
   from public.snags
   where id = (select (v->>'snag_id')::uuid from probe where k = 'a')),
  'a lad marks it fixed and the device time is kept'
);

insert into probe (k, v)
values (
  'open',
  public.create_snag(
    gen_random_uuid(),
    :'sitea'::uuid,
    'Still open',
    'First',
    'dryliner',
    now() - interval '2 hours',
    pg_temp.one_photo(:'firmx'::uuid, :'sitea'::uuid, 'open.jpg')
  )
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_off_snags_internal('
      || quote_literal('c3333333-3333-4333-8333-333333333331')
      || '::uuid, ' || quote_literal(:'sitea') || '::uuid, now(), ''Nope'')',
    'not_authorized'
  ),
  'an operative cannot sign off as the contracts manager'
);

select pg_temp.ok(
  public.snag_trade_labels(:'sitea'::uuid) = '["contracts","dryliner"]'::jsonb,
  'trade suggestions come from people on the site'
);

reset role;
select pg_temp.jwt(:'cmx'::uuid);
set local role authenticated;

insert into probe (k, v)
values (
  'sign1',
  public.sign_off_snags_internal(
    'c3333333-3333-4333-8333-333333333331'::uuid,
    :'sitea'::uuid,
    now() - interval '20 minutes',
    'Northbuild Site'
  )
);

select pg_temp.ok(
  (select status = 'Signed off' from public.snags where id = (select (v->>'snag_id')::uuid from probe where k = 'a'))
  and (select status = 'Open' from public.snags where id = (select (v->>'snag_id')::uuid from probe where k = 'open'))
  and (select signer_name = 'CM X'
          and signer_role = 'Contracts manager'
          and signer_company = 'Northbuild Site'
          and signature_png is null
          and kind = 'internal'
          and confirmation_text = 'I''ve checked the snags marked complete below and I''m satisfied they''ve been put right. This is an internal check for Northbuild Site, not sign-off by the main contractor.'
          and signed_at = now() - interval '20 minutes'
          and signed_received_at = now()
       from public.snag_signatures
       where snag_id = (select (v->>'snag_id')::uuid from probe where k = 'a'))
  and (select confirmation_text = 'I''ve checked the snags marked complete below and I''m satisfied they''ve been put right. This is an internal check for Northbuild Site, not sign-off by the main contractor.'
          and jsonb_array_length(covered) = 1
          and covered->0->>'status' = 'Fixed'
          and covered->0->>'snag_id' = (select v->>'snag_id' from probe where k = 'a')
          and covered->0->'photo_paths' @> jsonb_build_array(:'firmx' || '/' || :'sitea' || '/snags/a.jpg')
          and jsonb_array_length(outstanding) = 1
          and outstanding->0->>'note' = 'Still open'
          and outstanding->0->>'level_area' = 'First'
          and outstanding->0->>'snag_id' = (select v->>'snag_id' from probe where k = 'open')
       from public.snag_signoffs
       where id = 'c3333333-3333-4333-8333-333333333331'::uuid),
  'a partial internal sign-off stores the sentence, the covered snapshot, and the outstanding list'
);

select pg_temp.ok(
  pg_temp.raises(
    'update public.snag_signoffs set signer_company = ''Hacked'' where id = ''c3333333-3333-4333-8333-333333333331''::uuid',
    'permission denied for table snag_signoffs'
  ),
  'a signed sign-off is not updated by the client'
);

select pg_temp.ok(
  pg_temp.raises(
    'update public.snags set note = ''Hacked'' where id = '
      || quote_literal((select v->>'snag_id' from probe where k = 'a')) || '::uuid',
    'permission denied for table snags'
  ),
  'a signed-off snag is not updated by the client'
);

reset role;

select pg_temp.ok(
  pg_temp.raises(
    'update public.snags set note = ''Hacked'' where id = '
      || quote_literal((select v->>'snag_id' from probe where k = 'a')) || '::uuid',
    'snag_locked'
  ),
  'a signed-off snag cannot be edited in place even by the table owner'
);

select pg_temp.ok(
  pg_temp.raises(
    'update public.snag_signoffs set signer_company = ''Hacked'' where id = ''c3333333-3333-4333-8333-333333333331''::uuid',
    'closed'
  ),
  'editing a signed sign-off is rejected'
);

select pg_temp.jwt(:'cmx'::uuid);
set local role authenticated;

select public.fix_snag(
  (select (v->>'snag_id')::uuid from probe where k = 'open'),
  now() - interval '15 minutes',
  pg_temp.one_photo(:'firmx'::uuid, :'sitea'::uuid, 'open-after.jpg')
);

insert into probe (k, v)
values (
  'sign2',
  public.sign_off_snags_internal(
    'c3333333-3333-4333-8333-333333333332'::uuid,
    :'sitea'::uuid,
    now() - interval '5 minutes',
    'Northbuild Site'
  )
);

select pg_temp.ok(
  (select count(*) from public.snag_signoffs where site_id = :'sitea'::uuid) = 2
  and (select jsonb_array_length(outstanding) = 1 from public.snag_signoffs where id = 'c3333333-3333-4333-8333-333333333331'::uuid)
  and (select jsonb_array_length(covered) = 1 and jsonb_array_length(outstanding) = 0
       from public.snag_signoffs where id = 'c3333333-3333-4333-8333-333333333332'::uuid)
  and (select status = 'Signed off' from public.snags where id = (select (v->>'snag_id')::uuid from probe where k = 'open')),
  'a later fix plus a new sign-off creates a second record and leaves the first outstanding list'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_off_snags_internal('
      || quote_literal('c3333333-3333-4333-8333-333333333339')
      || '::uuid, ' || quote_literal(:'sitea') || '::uuid, now(), ''Northbuild Site'')',
    'closed'
  ),
  'a sign-off with nothing left to cover is refused'
);

reset role;

select pg_temp.jwt(:'opb'::uuid);
set local role authenticated;

insert into probe (k, v)
values (
  'b',
  public.create_snag(
    gen_random_uuid(),
    :'siteb'::uuid,
    'Site B crack',
    'First',
    'labourer',
    now() - interval '2 hours',
    pg_temp.one_photo(:'firmx'::uuid, :'siteb'::uuid, 'b.jpg')
  )
);

select public.fix_snag(
  (select (v->>'snag_id')::uuid from probe where k = 'b'),
  now() - interval '30 minutes',
  pg_temp.one_photo(:'firmx'::uuid, :'siteb'::uuid, 'b-after.jpg')
);

insert into probe (k, v)
values (
  'signb',
  public.sign_off_snags_contractor(
    'c3333333-3333-4333-8333-333333333333'::uuid,
    :'siteb'::uuid,
    now() - interval '10 minutes',
    'Dave Moran',
    'Site manager',
    'Northbuild',
    'data:image/png;base64,' || repeat('QUFB', 20)
  )
);

select pg_temp.ok(
  (select status = 'Signed off' from public.snags where id = (select (v->>'snag_id')::uuid from probe where k = 'b'))
  and (select signer_name = 'Dave Moran'
          and signer_role = 'Site manager'
          and signer_company = 'Northbuild'
          and kind = 'contractor'
          and confirmation_text = 'I confirm the snags marked complete below have been put right to my satisfaction, on behalf of Northbuild.'
          and left(signature_png, 22) = 'data:image/png;base64,'
       from public.snag_signatures
       where snag_id = (select (v->>'snag_id')::uuid from probe where k = 'b'))
  and (select confirmation_text = 'I confirm the snags marked complete below have been put right to my satisfaction, on behalf of Northbuild.'
          and jsonb_array_length(outstanding) = 0
       from public.snag_signoffs
       where id = 'c3333333-3333-4333-8333-333333333333'::uuid),
  'the main contractor can sign on the phone'
);

reset role;
select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;

insert into probe (k, v)
values (
  'y',
  public.create_snag(
    gen_random_uuid(),
    :'sitey'::uuid,
    'Firm Y snag',
    null,
    'spark',
    now(),
    pg_temp.one_photo(:'firmy'::uuid, :'sitey'::uuid, 'y.jpg')
  )
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_snag(gen_random_uuid(), '
      || quote_literal(:'sitea') || '::uuid, ''Nope'', null, ''spark'', now(), '
      || 'pg_temp.one_photo(' || quote_literal(:'firmx') || '::uuid, ' || quote_literal(:'sitea') || '::uuid, ''nope.jpg''))',
    'not_authorized'
  ),
  'firm Y cannot raise a snag on firm X'
);

reset role;
select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.snags) = 2
  and not exists (select 1 from public.snags where site_id <> :'sitea'::uuid)
  and (select count(*) from public.snag_photos) = 4
  and (select count(*) from public.snag_signatures) = 2
  and (select count(*) from public.snag_signoffs) = 2
  and not exists (select 1 from public.snags where site_id = :'siteb'::uuid)
  and (select count(*) from storage.objects where bucket_id = 'site-photos') = 1
  and not exists (
    select 1 from storage.objects
    where bucket_id = 'site-photos' and name like '%' || :'siteb' || '%'
  ),
  'operative of site A cannot read site B snags or photos'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.snag_detail(' || quote_literal((select v->>'snag_id' from probe where k = 'b')) || '::uuid)',
    'not_authorized'
  ),
  'operative of site A cannot open site B snag detail'
);

select pg_temp.ok(
  pg_temp.raises(
    'insert into storage.objects (bucket_id, name) values (''site-photos'', '
      || quote_literal(:'firmx' || '/' || :'siteb' || '/snags/sneak.jpg') || ')',
    'new row violates row-level security policy for table "objects"'
  ),
  'operative of site A cannot store a photo on site B'
);

reset role;
select pg_temp.jwt(:'opb'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.snags) = 1
  and (select site_id from public.snags) = :'siteb'::uuid
  and (select count(*) from storage.objects where bucket_id = 'site-photos') = 1,
  'operative of site B cannot read site A'
);

reset role;
select pg_temp.jwt(:'cmx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.snags) = 2
  and not exists (select 1 from public.snags where site_id <> :'sitea'::uuid),
  'contracts manager sees assigned sites only'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.snags) = 3
  and (select count(*) from public.snags where company_id = :'firmy'::uuid) = 0
  and (select count(*) from storage.objects where bucket_id = 'site-photos') = 2
  and not exists (
    select 1 from storage.objects
    where bucket_id = 'site-photos' and name like :'firmy' || '%'
  ),
  'firm X cannot read firm Y snags or photos'
);

reset role;
select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.snags) = 1
  and (select company_id from public.snags) = :'firmy'::uuid
  and (select count(*) from storage.objects where bucket_id = 'site-photos') = 1
  and (select name from storage.objects where bucket_id = 'site-photos') like :'firmy' || '%',
  'firm Y cannot read firm X snags or photos'
);

reset role;

rollback;
