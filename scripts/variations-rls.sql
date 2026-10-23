-- Variations RLS. Apply scripts/throwaway-auth.sql and every migration first.
--   DATABASE_URL=postgres://postgres@127.0.0.1/sitepack_variations bash scripts/run-variation-rls.sh
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
      'storage_path', p_company::text || '/' || p_site::text || '/variations/' || p_name,
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
        'create_variation',
        'update_variation_draft',
        'set_variation_value',
        'sign_variation',
        'send_variation',
        'revise_variation',
        'list_variations',
        'variation_detail'
      )
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
        where c like 'search_path=%'
      )
  ) = 8,
  'variation functions pin search_path'
);

select pg_temp.ok(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname in (
        'create_variation',
        'update_variation_draft',
        'set_variation_value',
        'sign_variation',
        'send_variation',
        'revise_variation'
      )
  ) = 6
  and not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('list_variations', 'variation_detail')
      and p.prosecdef
  ),
  'writes are security definer and reads run as the caller'
);

select pg_temp.ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_variation',
        'update_variation_draft',
        'set_variation_value',
        'sign_variation',
        'send_variation',
        'revise_variation',
        'list_variations',
        'variation_detail'
      )
      and has_function_privilege('anon', p.oid, 'execute')
  )
  and not has_table_privilege('anon', 'public.variations', 'select')
  and not has_table_privilege('authenticated', 'public.variations', 'insert')
  and not has_table_privilege('authenticated', 'public.variation_versions', 'update'),
  'anon cannot execute any variation function and clients cannot write the tables directly'
);

select pg_temp.ok(
  (
    select count(*)
    from pg_policies
    where policyname in (
      'variations_select',
      'variation_versions_select',
      'variation_photos_select',
      'variation_signatures_select',
      'variation_counters_select',
      'site_photos_select',
      'site_photos_insert'
    )
  ) = 7,
  'RLS policies exist'
);

select pg_temp.ok(
  (select public is false and file_size_limit = 1572864 from storage.buckets where id = 'site-photos'),
  'site-photos is private and capped at 1.5MB'
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

insert into public.people (id, auth_user_id, company_id, role, display_name, email)
values
  (:'ownerx', :'ownerx', :'firmx', 'owner', 'Owner X', 'ownerx@firmx.test'),
  (:'cmx', :'cmx', :'firmx', 'cm', 'CM X', 'cmx@firmx.test'),
  (:'opa', :'opa', :'firmx', 'operative', 'Op A', 'opa@firmx.test'),
  (:'opb', :'opb', :'firmx', 'operative', 'Op B', 'opb@firmx.test'),
  (:'ownery', :'ownery', :'firmy', 'owner', 'Owner Y', 'ownery@firmy.test');

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
  ('site-photos', :'firmx' || '/' || :'sitea' || '/variations/a.jpg'),
  ('site-photos', :'firmx' || '/' || :'siteb' || '/variations/b.jpg'),
  ('site-photos', :'firmy' || '/' || :'sitey' || '/variations/y.jpg');

select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_variation('
      || quote_literal(:'sitea') || '::uuid, ''Extra beads'', ''Note'', null, null, 100, '
      || 'pg_temp.one_photo(' || quote_literal(:'firmx') || '::uuid, ' || quote_literal(:'sitea') || '::uuid, ''bad.jpg''))',
    'value_not_allowed'
  ),
  'operative cannot set the pound value'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_variation('
      || quote_literal(:'sitea') || '::uuid, ''Extra beads'', ''Note'', null, null, null, '
      || 'jsonb_build_array(jsonb_build_object('
      || '''storage_path'', ' || quote_literal(:'firmx') || ' || ''/'' || ' || quote_literal(:'sitea') || ' || ''/variations/../bad.jpg'','
      || '''content_type'', ''image/jpeg'', ''file_size_bytes'', 1200)))',
    'invalid_path'
  ),
  'a photo path cannot contain dot-dot'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_variation('
      || quote_literal(:'sitea') || '::uuid, ''Extra beads'', ''Note'', null, null, null, '
      || 'jsonb_build_array(jsonb_build_object('
      || '''storage_path'', ''/variations/bad.jpg'','
      || '''content_type'', ''image/jpeg'', ''file_size_bytes'', 1200)))',
    'invalid_path'
  ),
  'a photo path cannot start with a slash'
);

insert into probe (k, v)
values (
  'a',
  public.create_variation(
    :'sitea'::uuid,
    'Extra beads',
    'Window reveals',
    'L2',
    '12 m',
    null,
    pg_temp.one_photo(:'firmx'::uuid, :'sitea'::uuid, 'a.jpg')
  )
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.set_variation_value(' || quote_literal((select v->>'version_id' from probe where k = 'a')) || '::uuid, 2500)',
    'value_not_allowed'
  ),
  'operative cannot edit the pound value'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (public.set_variation_value((select (v->>'version_id')::uuid from probe where k = 'a'), 2500) ->> 'value_pence')::integer = 2500,
  'owner can set the pound value on a draft'
);

select pg_temp.ok(
  (public.list_variations(:'sitea'::uuid) -> 'rows' -> 0 ->> 'value_pence')::integer = 2500
  and (public.variation_detail((select (v->>'variation_id')::uuid from probe where k = 'a')) -> 'current' ->> 'value_pence')::integer = 2500
  and (private.variation_version_json((select (v->>'version_id')::uuid from probe where k = 'a')) ->> 'value_pence')::integer = 2500,
  'a manager read returns the stored pound amount'
);

reset role;
select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  not has_column_privilege('authenticated', 'public.variation_versions', 'value_pence', 'select')
  and not has_column_privilege('authenticated', 'public.variation_signatures', 'shown_value_pence', 'select')
  and pg_temp.raises(
    'select value_pence from public.variation_versions where id = '
      || quote_literal((select v->>'version_id' from probe where k = 'a')) || '::uuid',
    'permission denied for table variation_versions'
  )
  and pg_temp.raises(
    'select shown_value_pence from public.variation_signatures where version_id = '
      || quote_literal((select v->>'version_id' from probe where k = 'a')) || '::uuid',
    'permission denied for table variation_signatures'
  ),
  'operative select of the pound column is denied'
);

select pg_temp.ok(
  (public.list_variations(:'sitea'::uuid) -> 'rows' -> 0 ->> 'value_pence') is null
  and (public.variation_detail((select (v->>'variation_id')::uuid from probe where k = 'a')) -> 'current' ->> 'value_pence') is null
  and (private.variation_version_json((select (v->>'version_id')::uuid from probe where k = 'a')) ->> 'value_pence') is null,
  'operative list, detail and version json return a null pound amount'
);

select pg_temp.ok(
  (public.update_variation_draft(
    (select (v->>'version_id')::uuid from probe where k = 'a'),
    'Extra beads',
    'Window reveals level 2',
    'L2',
    '12 m',
    pg_temp.one_photo(:'firmx'::uuid, :'sitea'::uuid, 'a.jpg')
  ) ->> 'version_id') = (select v->>'version_id' from probe where k = 'a'),
  'draft edits stay on the same version'
);

insert into probe (k, v)
values (
  'a-sign',
  public.sign_variation(
    (select (v->>'version_id')::uuid from probe where k = 'a'),
    'Dave Moran',
    'Site manager',
    'Northbuild',
    'data:image/png;base64,' || repeat('QUFB', 20),
    null
  )
);

select pg_temp.ok(
  (select v->>'status' from probe where k = 'a-sign') = 'Signed'
  and (select v->>'confirmation_text' from probe where k = 'a-sign') = 'I confirm I instructed this extra work on behalf of Northbuild. The price is still to be agreed.'
  and (select v->>'shown_value_pence' from probe where k = 'a-sign') is null,
  'an operative sign-off uses the no-price sentence and snapshots no amount'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.send_variation(' || quote_literal((select v->>'version_id' from probe where k = 'a')) || '::uuid)',
    'not_authorized'
  ),
  'operative cannot send'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'select public.update_variation_draft('
      || quote_literal((select v->>'version_id' from probe where k = 'a'))
      || '::uuid, ''Changed'', ''Nope'', null, null, pg_temp.one_photo('
      || quote_literal(:'firmx') || '::uuid, ' || quote_literal(:'sitea') || '::uuid, ''a.jpg''))',
    'variation_locked'
  ),
  'owner cannot edit a signed record in place'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.set_variation_value(' || quote_literal((select v->>'version_id' from probe where k = 'a')) || '::uuid, 999)',
    'variation_locked'
  ),
  'owner cannot change the pound value on a signed record in place'
);

reset role;

select pg_temp.ok(
  pg_temp.raises(
    'update public.variation_versions set title = ''Hacked'' where id = '
      || quote_literal((select v->>'version_id' from probe where k = 'a')) || '::uuid',
    'variation_locked'
  ),
  'a signed record cannot be edited in place even by the table owner'
);

select pg_temp.ok(
  (select title from public.variation_versions where id = (select (v->>'version_id')::uuid from probe where k = 'a')) = 'Extra beads'
  and (select value_pence from public.variation_versions where id = (select (v->>'version_id')::uuid from probe where k = 'a')) = 2500
  and (select signer_name from public.variation_signatures where version_id = (select (v->>'version_id')::uuid from probe where k = 'a')) = 'Dave Moran',
  'the signed title, amount, and signature are unchanged'
);

select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (public.send_variation((select (v->>'version_id')::uuid from probe where k = 'a')) ->> 'status') = 'Sent',
  'owner can mark a signed variation sent'
);

select pg_temp.ok(
  (select (public.list_variations(:'sitea'::uuid) ->> 'signed_count')::integer) = 1
  and (select (public.list_variations(:'sitea'::uuid) ->> 'open_count')::integer) = 0,
  'the site list counts the signed current version'
);

insert into probe (k, v)
values (
  'a2',
  public.revise_variation((select (v->>'version_id')::uuid from probe where k = 'a'))
);

select pg_temp.ok(
  (select v->>'status' from probe where k = 'a2') = 'Draft'
  and (select (v->>'version_no')::integer from probe where k = 'a2') = 2
  and (select status from public.variation_versions where id = (select (v->>'version_id')::uuid from probe where k = 'a')) = 'Sent'
  and (select is_current from public.variation_versions where id = (select (v->>'version_id')::uuid from probe where k = 'a')) = false
  and (select is_current from public.variation_versions where id = (select (v->>'version_id')::uuid from probe where k = 'a2')) = true
  and (private.variation_version_json((select (v->>'version_id')::uuid from probe where k = 'a2')) ->> 'value_pence')::integer = 2500
  and (select count(*) from public.variation_signatures where version_id = (select (v->>'version_id')::uuid from probe where k = 'a')) = 1
  and (select count(*) from public.variation_signatures where version_id = (select (v->>'version_id')::uuid from probe where k = 'a2')) = 0,
  'an edit after signing creates a new version and keeps the signed one'
);

reset role;

select pg_temp.ok(
  pg_temp.raises(
    'update public.variation_versions set description = ''Still no'' where id = '
      || quote_literal((select v->>'version_id' from probe where k = 'a')) || '::uuid',
    'variation_locked'
  ),
  'the kept signed version still cannot be edited in place'
);

select pg_temp.jwt(:'opb'::uuid);
set local role authenticated;

insert into probe (k, v)
values (
  'b',
  public.create_variation(
    :'siteb'::uuid,
    'Site B extra',
    'Other site',
    null,
    null,
    null,
    pg_temp.one_photo(:'firmx'::uuid, :'siteb'::uuid, 'b.jpg')
  )
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select public.set_variation_value((select (v->>'version_id')::uuid from probe where k = 'b'), 500);

reset role;
select pg_temp.jwt(:'opb'::uuid);
set local role authenticated;

select pg_temp.ok(
  (public.sign_variation(
    (select (v->>'version_id')::uuid from probe where k = 'b'),
    'Sam Cole',
    'Foreman',
    'Otherbuild',
    'data:image/png;base64,' || repeat('QUFB', 20),
    null
  ) ->> 'shown_value_pence') is null,
  'an operative sign-off snapshots no pound amount'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_variation('
      || quote_literal((select v->>'version_id' from probe where k = 'b'))
      || '::uuid, ''Sam Cole'', ''Foreman'', ''Otherbuild'', ''data:image/png;base64,'
      || repeat('QUFB', 20) || ''', 500)',
    'variation_locked'
  ),
  'a signed variation cannot be signed again'
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.revise_variation(' || quote_literal((select v->>'version_id' from probe where k = 'b')) || '::uuid)',
    'not_authorized'
  ),
  'an operative cannot revise a signed variation'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

insert into probe (k, v)
values (
  'b2',
  public.revise_variation((select (v->>'version_id')::uuid from probe where k = 'b'))
);

select pg_temp.ok(
  (public.variation_detail((select (v->>'variation_id')::uuid from probe where k = 'b')) -> 'current' ->> 'value_pence')::integer = 500
  and (public.variation_detail((select (v->>'variation_id')::uuid from probe where k = 'b')) -> 'history' -> 0 ->> 'value_pence')::integer = 500,
  'a manager revision keeps the pound amount and the signed version'
);

reset role;
select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;

insert into probe (k, v)
values (
  'y',
  public.create_variation(
    :'sitey'::uuid,
    'Firm Y extra',
    'Other firm',
    null,
    null,
    100,
    pg_temp.one_photo(:'firmy'::uuid, :'sitey'::uuid, 'y.jpg')
  )
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.create_variation('
      || quote_literal(:'sitea') || '::uuid, ''Nope'', '''', null, null, null, pg_temp.one_photo('
      || quote_literal(:'firmx') || '::uuid, ' || quote_literal(:'sitea') || '::uuid, ''nope.jpg''))',
    'not_authorized'
  ),
  'firm Y cannot create on firm X'
);

reset role;
set constraints all immediate;

select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.variations) = 1
  and (select count(*) from public.variation_versions) = 2
  and (select count(*) from public.variation_photos) = 2
  and (select count(*) from public.variation_signatures) = 1
  and (select count(*) from public.variation_counters) = 1
  and (select count(*) from storage.objects where bucket_id = 'site-photos') = 1
  and not exists (
    select 1 from public.variations where site_id = :'siteb'::uuid
  )
  and not exists (
    select 1 from storage.objects
    where bucket_id = 'site-photos' and name like '%' || :'siteb' || '%'
  ),
  'operative of site A cannot read site B variations or photos'
);

select pg_temp.ok(
  pg_temp.raises(
    'insert into storage.objects (bucket_id, name) values (''site-photos'', '
      || quote_literal(:'firmx' || '/' || :'siteb' || '/variations/sneak.jpg') || ')',
    'new row violates row-level security policy for table "objects"'
  ),
  'operative of site A cannot store a photo on site B'
);

select pg_temp.ok(
  pg_temp.raises(
    'insert into storage.objects (bucket_id, name) values (''site-photos'', '
      || quote_literal(:'firmx' || '/' || :'sitea' || '/../variations/sneak.jpg') || ')',
    'new row violates row-level security policy for table "objects"'
  )
  and pg_temp.raises(
    'insert into storage.objects (bucket_id, name) values (''site-photos'', ''/'
      || :'firmx' || '/' || :'sitea' || '/variations/sneak.jpg'')',
    'new row violates row-level security policy for table "objects"'
  ),
  'a storage key cannot contain dot-dot or start with a slash'
);

reset role;
select pg_temp.jwt(:'opb'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.variations) = 1
  and (select site_id from public.variations) = :'siteb'::uuid
  and (select count(*) from storage.objects where bucket_id = 'site-photos') = 1,
  'operative of site B cannot read site A'
);

reset role;
select pg_temp.jwt(:'cmx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.variations) = 1
  and (select site_id from public.variations) = :'sitea'::uuid,
  'contracts manager sees assigned sites only'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.variations) = 2
  and (select count(*) from public.variations where company_id = :'firmy'::uuid) = 0
  and (select count(*) from storage.objects where bucket_id = 'site-photos') = 2
  and not exists (
    select 1 from storage.objects
    where bucket_id = 'site-photos' and name like :'firmy' || '%'
  ),
  'firm X cannot read firm Y variations or photos'
);

reset role;
select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.variations) = 1
  and (select company_id from public.variations) = :'firmy'::uuid
  and (select count(*) from public.variation_versions) = 1
  and (select count(*) from storage.objects where bucket_id = 'site-photos') = 1
  and (select name from storage.objects where bucket_id = 'site-photos') like :'firmy' || '%',
  'firm Y cannot read firm X variations or photos'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;
set constraints all deferred;

insert into probe (k, v)
values (
  'priced',
  public.create_variation(
    :'sitea'::uuid,
    'Priced beads',
    'Shown amount',
    null,
    null,
    14550,
    pg_temp.one_photo(:'firmx'::uuid, :'sitea'::uuid, 'priced.jpg')
  )
);

select pg_temp.ok(
  pg_temp.raises(
    'select public.sign_variation('
      || quote_literal((select v->>'version_id' from probe where k = 'priced'))
      || '::uuid, ''Dave Moran'', ''Site manager'', ''Northbuild'', ''data:image/png;base64,'
      || repeat('QUFB', 20) || ''', 1)',
    'value_mismatch'
  ),
  'a sign-off rejects an amount that is not the stored value'
);

insert into probe (k, v)
values (
  'priced-sign',
  public.sign_variation(
    (select (v->>'version_id')::uuid from probe where k = 'priced'),
    'Dave Moran',
    'Site manager',
    'Northbuild',
    'data:image/png;base64,' || repeat('QUFB', 20),
    14550
  )
);

select pg_temp.ok(
  (select v->>'confirmation_text' from probe where k = 'priced-sign') = 'I confirm I instructed this extra work on behalf of Northbuild and agree the amount shown.'
  and (select (v->>'shown_value_pence')::integer from probe where k = 'priced-sign') = 14550
  and (private.variation_version_json((select (v->>'version_id')::uuid from probe where k = 'priced')) -> 'signature' ->> 'shown_value_pence')::integer = 14550,
  'a priced manager sign-off stores the server sentence and the shown amount'
);

select pg_temp.ok(
  private.visible_variation_pence((select (v->>'version_id')::uuid from probe where k = 'priced')) = 14550
  and private.visible_shown_pence((select (v->>'version_id')::uuid from probe where k = 'priced')) = 14550,
  'a same-company manager can read the pound amount'
);

reset role;
select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;

select pg_temp.ok(
  private.visible_variation_pence((select (v->>'version_id')::uuid from probe where k = 'priced')) is null
  and private.visible_shown_pence((select (v->>'version_id')::uuid from probe where k = 'priced')) is null,
  'a manager in another company cannot read the pound amount'
);

reset role;

rollback;
