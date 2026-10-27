-- Site document RLS. Apply scripts/throwaway-auth.sql and every migration first.
-- The checks roll back. Nothing here is a hosted project.

\set ON_ERROR_STOP on
\set firmx 'c1111111-1111-4111-8111-111111111111'
\set firmy 'c2222222-2222-4222-8222-222222222222'
\set ownerx 'a1111111-1111-4111-8111-111111111111'
\set cmx 'a1111111-1111-4111-8111-111111111112'
\set opa 'a1111111-1111-4111-8111-111111111113'
\set ownery 'a2222222-2222-4222-8222-222222222221'
\set sitea '51111111-1111-4111-8111-111111111111'
\set siteb '51111111-1111-4111-8111-111111111112'
\set doc1 'd3111111-1111-4111-8111-111111111111'
\set ver1 'd3111111-1111-4111-8111-111111111112'
\set ver2 'd3111111-1111-4111-8111-111111111113'

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

insert into auth.users (id, email)
values
  (:'ownerx', 'ownerx@firmx.test'),
  (:'cmx', 'cmx@firmx.test'),
  (:'opa', 'opa@firmx.test'),
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
  (:'ownery', :'ownery', :'firmy', 'owner', 'Owner Y', 'ownery@firmy.test');

insert into public.sites (id, company_id, name)
values
  (:'sitea', :'firmx', 'Site A'),
  (:'siteb', :'firmx', 'Site B');

insert into public.site_assignments (site_id, person_id)
values
  (:'sitea', :'cmx'),
  (:'sitea', :'opa');

select pg_temp.ok(
  not has_table_privilege('anon', 'public.site_documents', 'select')
    and not has_table_privilege('anon', 'public.site_document_versions', 'select')
    and not has_table_privilege('anon', 'public.site_document_signatures', 'select')
    and has_table_privilege('authenticated', 'public.site_documents', 'select, insert, delete')
    and has_column_privilege('authenticated', 'public.site_documents', 'archived_at', 'update')
    and not has_column_privilege('authenticated', 'public.site_documents', 'title', 'update')
    and not has_function_privilege('authenticated', 'private.supersede_site_document_version()', 'execute')
    and not has_function_privilege('anon', 'private.supersede_site_document_version()', 'execute')
    and not has_function_privilege('authenticated', 'private.stamp_site_document_signature()', 'execute')
    and not has_function_privilege('anon', 'private.stamp_site_document_signature()', 'execute')
    and has_table_privilege('authenticated', 'public.site_document_versions', 'select, insert, update')
    and not has_table_privilege('authenticated', 'public.site_document_versions', 'delete')
    and has_table_privilege('authenticated', 'public.site_document_signatures', 'select, insert')
    and not has_table_privilege('authenticated', 'public.site_document_signatures', 'update, delete'),
  'grants are select for members, owner writes, signature insert, and no trigger execute'
);

select pg_temp.jwt(:'cmx'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'insert into public.site_documents (id, site_id, company_id, kind, title, created_by) values ('
      || quote_literal(:'doc1') || '::uuid, '
      || quote_literal(:'sitea') || '::uuid, '
      || quote_literal(:'firmx') || '::uuid, ''induction'', ''Induction'', '
      || quote_literal(:'cmx') || '::uuid)',
    'new row violates row-level security policy for table "site_documents"'
  ),
  'a contracts manager cannot upload a document'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

insert into public.site_documents (id, site_id, company_id, kind, title, created_by)
values (:'doc1', :'sitea', :'firmx', 'induction', 'Site induction', :'ownerx');

insert into public.site_document_versions (
  id, document_id, site_id, company_id, version_no, storage_path, file_name, is_current, created_by
) values (
  :'ver1', :'doc1', :'sitea', :'firmx', 1,
  :'firmx' || '/' || :'sitea' || '/' || :'doc1' || '/' || :'ver1' || '.pdf',
  'induction.pdf', true, :'ownerx'
);

select pg_temp.ok(
  (select version_no = 1 and is_current from public.site_document_versions where id = :'ver1'::uuid),
  'the first upload is version 1 and current'
);

insert into storage.objects (bucket_id, name)
values (
  'site-documents',
  :'firmx' || '/' || :'sitea' || '/' || :'doc1' || '/' || :'ver1' || '.pdf'
);

reset role;
select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.site_documents where id = :'doc1'::uuid) = 1
    and (select count(*) from public.site_documents) = 1,
  'an assigned operative can read the document'
);

select pg_temp.ok(
  pg_temp.raises(
    'insert into public.site_document_signatures (version_id, document_id, site_id, person_id, signed_at) values ('
      || quote_literal(:'ver1') || '::uuid, '
      || quote_literal(:'doc1') || '::uuid, '
      || quote_literal(:'sitea') || '::uuid, '
      || quote_literal(:'cmx') || '::uuid, ''2000-01-01'')',
    'new row violates row-level security policy for table "site_document_signatures"'
  ),
  'a signature cannot be inserted for someone else'
);

insert into public.site_document_signatures (version_id, document_id, site_id, person_id, signed_at)
values (:'ver1', :'doc1', :'sitea', :'opa', '2000-01-01');

select pg_temp.ok(
  (select signed_at > now() - interval '5 minutes' from public.site_document_signatures where person_id = :'opa'::uuid),
  'signed_at comes from the database clock'
);

reset role;
select pg_temp.jwt(:'cmx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.site_document_signatures where person_id = :'opa'::uuid) = 0,
  'a contracts manager cannot read someone else''s signature'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.site_document_signatures where version_id = :'ver1'::uuid) = 1,
  'the owner can read who signed'
);

insert into public.site_document_versions (
  id, document_id, site_id, company_id, version_no, storage_path, file_name, is_current, created_by
) values (
  :'ver2', :'doc1', :'sitea', :'firmx', 1,
  :'firmx' || '/' || :'sitea' || '/' || :'doc1' || '/' || :'ver2' || '.pdf',
  'induction-v2.pdf', true, :'ownerx'
);

select pg_temp.ok(
  (select version_no = 2 and is_current from public.site_document_versions where id = :'ver2'::uuid)
    and (select is_current = false from public.site_document_versions where id = :'ver1'::uuid)
    and (select count(*) from public.site_document_signatures where version_id = :'ver2'::uuid) = 0,
  'a new version is current, the old one is superseded, and signatures do not carry over'
);

select pg_temp.ok(
  pg_temp.raises(
    'insert into public.site_document_signatures (version_id, document_id, site_id, person_id) values ('
      || quote_literal(:'ver2') || '::uuid, '
      || quote_literal(:'doc1') || '::uuid, '
      || quote_literal(:'siteb') || '::uuid, '
      || quote_literal(:'ownerx') || '::uuid)',
    'new row violates row-level security policy for table "site_document_signatures"'
  ),
  'a signature cannot name a different site from the version'
);

select pg_temp.ok(
  pg_temp.raises(
    'insert into public.site_document_signatures (version_id, document_id, site_id, person_id) values ('
      || quote_literal(:'ver2') || '::uuid, '
      || quote_literal('d3111111-1111-4111-8111-111111111119') || '::uuid, '
      || quote_literal(:'sitea') || '::uuid, '
      || quote_literal(:'ownerx') || '::uuid)',
    'new row violates row-level security policy for table "site_document_signatures"'
  ),
  'a signature cannot name a different document from the version'
);

reset role;
update public.sites set archived_at = now() where id = :'sitea'::uuid;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'insert into public.site_document_signatures (version_id, document_id, site_id, person_id) values ('
      || quote_literal(:'ver2') || '::uuid, '
      || quote_literal(:'doc1') || '::uuid, '
      || quote_literal(:'sitea') || '::uuid, '
      || quote_literal(:'ownerx') || '::uuid)',
    'new row violates row-level security policy for table "site_document_signatures"'
  ),
  'a signature on an archived site is refused'
);

reset role;
update public.sites set archived_at = null where id = :'sitea'::uuid;

select pg_temp.ok(
  (select public is false
      and file_size_limit = 20971520
      and allowed_mime_types = array['application/pdf']::text[]
    from storage.buckets where id = 'site-documents'),
  'the site-documents bucket is private, 20MB, and PDF only'
);

select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'insert into public.site_document_signatures (version_id, document_id, site_id, person_id) values ('
      || quote_literal(:'ver1') || '::uuid, '
      || quote_literal(:'doc1') || '::uuid, '
      || quote_literal(:'sitea') || '::uuid, '
      || quote_literal(:'opa') || '::uuid)',
    'new row violates row-level security policy for table "site_document_signatures"'
  ),
  'a superseded version cannot be signed'
);

insert into public.site_document_signatures (version_id, document_id, site_id, person_id)
values (:'ver2', :'doc1', :'sitea', :'opa');

select pg_temp.ok(
  pg_temp.raises(
    'delete from public.site_documents where id = ' || quote_literal(:'doc1') || '::uuid',
    'new row violates row-level security policy for table "site_documents"'
  )
  or (select count(*) from public.site_documents where id = :'doc1'::uuid) = 1,
  'an operative cannot delete the document'
);

reset role;
select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.site_documents) = 0,
  'another company cannot read the document'
);

reset role;
select pg_temp.jwt(:'cmx'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises(
    'delete from storage.objects where bucket_id = ''site-documents'' and name = '
      || quote_literal(:'firmx' || '/' || :'sitea' || '/' || :'doc1' || '/' || :'ver1' || '.pdf'),
    'new row violates row-level security policy for table "objects"'
  )
  or (select count(*) from storage.objects where bucket_id = 'site-documents') = 1,
  'a contracts manager cannot delete the PDF'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

delete from public.site_documents where id = :'doc1'::uuid;

select pg_temp.ok(
  (select count(*) from public.site_documents where id = :'doc1'::uuid) = 1
    and (select count(*) from public.site_document_signatures where document_id = :'doc1'::uuid) = 2,
  'the owner cannot delete a document that has signatures'
);

update public.site_documents set archived_at = now() where id = :'doc1'::uuid;

select pg_temp.ok(
  (select archived_at > now() - interval '5 minutes' from public.site_documents where id = :'doc1'::uuid)
    and (select count(*) from public.site_document_versions where document_id = :'doc1'::uuid) = 2
    and (select count(*) from public.site_document_signatures where document_id = :'doc1'::uuid) = 2,
  'archiving keeps the document, its versions, and its signatures'
);

reset role;
select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.site_documents) = 0
    and (select count(*) from public.site_document_versions) = 0
    and (select count(*) from public.site_document_signatures) = 0,
  'an archived document is hidden from members'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.site_documents where id = :'doc1'::uuid) = 1,
  'the owner can still see an archived document'
);

insert into public.site_documents (id, site_id, company_id, kind, title, created_by)
values ('d3111111-1111-4111-8111-111111111114', :'sitea', :'firmx', 'rams', 'Unsigned RAMS', :'ownerx');

insert into public.site_document_versions (
  id, document_id, site_id, company_id, version_no, storage_path, file_name, is_current, created_by
) values (
  'd3111111-1111-4111-8111-111111111115',
  'd3111111-1111-4111-8111-111111111114',
  :'sitea', :'firmx', 1,
  :'firmx' || '/' || :'sitea' || '/d3111111-1111-4111-8111-111111111114/d3111111-1111-4111-8111-111111111115.pdf',
  'rams.pdf', true, :'ownerx'
);

delete from public.site_documents where id = 'd3111111-1111-4111-8111-111111111114'::uuid;

select pg_temp.ok(
  (select count(*) from public.site_documents where id = 'd3111111-1111-4111-8111-111111111114'::uuid) = 0
    and (select count(*) from public.site_documents where id = :'doc1'::uuid) = 1,
  'the owner can delete a document that has no signatures'
);

select pg_temp.ok(
  (select count(*) from storage.objects
    where bucket_id = 'site-documents'
      and name = :'firmx' || '/' || :'sitea' || '/' || :'doc1' || '/' || :'ver1' || '.pdf') = 1,
  'archiving leaves the PDF in storage'
);

reset role;

insert into storage.objects (bucket_id, name)
values
  ('site-photos', :'firmx' || '/' || :'sitea' || '/photo.jpg'),
  ('site-photos', :'firmx' || '/' || :'sitea' || '/kept.jpg'),
  ('site-photos', :'firmx' || '/' || :'sitea' || '/variation.jpg'),
  ('site-photos', :'firmy' || '/other/photo.jpg');

insert into public.snags (
  id, site_id, company_id, snag_seq, note, trade_label, raised_by, raised_by_name, raised_at, status
) values (
  'd4111111-1111-4111-8111-111111111111',
  :'sitea', :'firmx', 1, 'Crack', 'Plaster', :'ownerx', 'Owner X', now(), 'Open'
);

insert into public.snag_photos (
  snag_id, site_id, kind, storage_path, sort_order, content_type, file_size_bytes
) values (
  'd4111111-1111-4111-8111-111111111111',
  :'sitea', 'before',
  :'firmx' || '/' || :'sitea' || '/kept.jpg',
  1, 'image/jpeg', 100
);

insert into public.variations (id, site_id, company_id, vo_seq, created_by)
values ('d4111111-1111-4111-8111-111111111112', :'sitea', :'firmx', 1, :'ownerx');

insert into public.variation_versions (id, variation_id, site_id, version_no, title, status, created_by)
values (
  'd4111111-1111-4111-8111-111111111113',
  'd4111111-1111-4111-8111-111111111112',
  :'sitea', 1, 'Extra', 'Draft', :'ownerx'
);

insert into public.variation_photos (
  version_id, site_id, storage_path, sort_order, content_type, file_size_bytes
) values (
  'd4111111-1111-4111-8111-111111111113',
  :'sitea',
  :'firmx' || '/' || :'sitea' || '/variation.jpg',
  1, 'image/jpeg', 100
);

select pg_temp.jwt(:'cmx'::uuid);
set local role authenticated;

delete from storage.objects
where bucket_id = 'site-photos'
  and name = :'firmx' || '/' || :'sitea' || '/photo.jpg';

reset role;

select pg_temp.ok(
  (select count(*) from storage.objects where bucket_id = 'site-photos' and name = :'firmx' || '/' || :'sitea' || '/photo.jpg') = 1,
  'a contracts manager cannot delete a site photo'
);

select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

delete from storage.objects
where bucket_id = 'site-photos'
  and name = :'firmx' || '/' || :'sitea' || '/photo.jpg';

delete from storage.objects
where bucket_id = 'site-photos'
  and name = :'firmx' || '/' || :'sitea' || '/kept.jpg';

delete from storage.objects
where bucket_id = 'site-photos'
  and name = :'firmx' || '/' || :'sitea' || '/variation.jpg';

delete from storage.objects
where bucket_id = 'site-photos'
  and name = :'firmy' || '/other/photo.jpg';

reset role;

select pg_temp.ok(
  (select count(*) from storage.objects where bucket_id = 'site-photos' and name = :'firmx' || '/' || :'sitea' || '/photo.jpg') = 0
    and (select count(*) from storage.objects where bucket_id = 'site-photos' and name = :'firmx' || '/' || :'sitea' || '/kept.jpg') = 1
    and (select count(*) from storage.objects where bucket_id = 'site-photos' and name = :'firmx' || '/' || :'sitea' || '/variation.jpg') = 1,
  'the owner can delete an orphan site photo but not one a snag or variation still uses'
);

select pg_temp.ok(
  (select count(*) from storage.objects where bucket_id = 'site-photos' and name = :'firmy' || '/other/photo.jpg') = 1,
  'the owner cannot delete another company site photo'
);

rollback;
