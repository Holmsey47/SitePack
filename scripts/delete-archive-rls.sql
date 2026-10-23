-- Delete-drawing and archive-site RLS. Apply scripts/throwaway-auth.sql and every migration first.
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
\set revold 'd1111111-1111-4111-8111-111111111111'
\set revloose 'd1111111-1111-4111-8111-111111111112'
\set revnew 'd1111111-1111-4111-8111-111111111113'
\set revkeep 'd1111111-1111-4111-8111-111111111114'
\set revb 'd1111111-1111-4111-8111-111111111115'
\set requesta 'b1111111-1111-4111-8111-111111111111'
\set snagb 'e1111111-1111-4111-8111-111111111111'

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
  not has_function_privilege('anon', 'public.delete_drawing(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.archive_site(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.restore_site(uuid)', 'execute')
  and not has_function_privilege('public', 'public.delete_drawing(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.delete_drawing(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.archive_site(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.restore_site(uuid)', 'execute'),
  'anon cannot execute the owner functions'
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
  (:'siteb', :'firmx', 'Site B');

insert into public.site_assignments (site_id, person_id)
values
  (:'sitea', :'cmx'),
  (:'sitea', :'opa'),
  (:'siteb', :'opb');

insert into public.drawings (id, site_id, title, sheet_number, revision, is_current, supersedes_id, storage_path)
values
  (:'revloose', :'sitea', 'GA', 'A-101', 'A', false, null, :'firmx' || '/' || :'sitea' || '/loose.pdf'),
  (:'revold', :'sitea', 'GA', 'A-101', 'B', false, null, :'firmx' || '/' || :'sitea' || '/old.pdf'),
  (:'revnew', :'sitea', 'GA', 'A-101', 'C', true, :'revold', :'firmx' || '/' || :'sitea' || '/new.pdf'),
  (:'revkeep', :'sitea', 'Section', 'A-201', 'A', true, null, :'firmx' || '/' || :'sitea' || '/keep.pdf'),
  (:'revb', :'siteb', 'Site B plan', 'B-1', 'A', true, null, :'firmx' || '/' || :'siteb' || '/plan.pdf');

insert into public.drawing_requests (id, site_id, requester_id, body, status, fulfilled_drawing_id)
values
  (:'requesta', :'sitea', :'opa', 'Need a section', 'Closed', :'revnew');

insert into public.drawing_seen (drawing_id, site_id, person_id, revision, seen_at)
values
  (:'revnew', :'sitea', :'opa', 'C', now());

insert into public.drawing_revision_opens (drawing_id, site_id, person_id, revision)
values
  (:'revnew', :'sitea', :'opa', 'C');

insert into public.snags (
  id, site_id, company_id, snag_seq, note, trade_label, raised_by, raised_by_name, raised_at, status
) values (
  :'snagb', :'siteb', :'firmx', 1, 'Cracked bead', 'Plaster', :'opb', 'Op B', now(), 'Open'
);

insert into public.variations (site_id, company_id, vo_seq, created_by)
values (:'siteb', :'firmx', 1, :'ownerx');

insert into storage.objects (bucket_id, name)
values
  ('drawings', :'firmx' || '/' || :'sitea' || '/loose.pdf'),
  ('drawings', :'firmx' || '/' || :'sitea' || '/old.pdf'),
  ('drawings', :'firmx' || '/' || :'sitea' || '/new.pdf'),
  ('drawings', :'firmx' || '/' || :'sitea' || '/keep.pdf'),
  ('drawings', :'firmy' || '/' || :'siteb' || '/other.pdf');

select pg_temp.jwt(:'cmx'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises('select public.delete_drawing(' || quote_literal(:'revnew') || '::uuid)', 'not_authorized')
  and pg_temp.raises('select public.archive_site(' || quote_literal(:'sitea') || '::uuid)', 'not_authorized')
  and pg_temp.raises('select public.restore_site(' || quote_literal(:'sitea') || '::uuid)', 'not_authorized')
  and pg_temp.raises('select public.archive_site(' || quote_literal(:'sitea') || '::uuid, true)', 'not_authorized')
  and pg_temp.raises('select public.list_drawing_orphans()', 'not_authorized')
  and pg_temp.raises('select public.clear_drawing_orphans(array[' || quote_literal(:'firmx' || '/' || :'sitea' || '/new.pdf') || '])', 'not_authorized')
  and pg_temp.raises(
    'update public.sites set archived_at = now() where id = ' || quote_literal(:'sitea') || '::uuid',
    'not_authorized'
  )
  and pg_temp.raises(
    'update public.sites set archived_by = ' || quote_literal(:'cmx') || '::uuid where id = ' || quote_literal(:'sitea') || '::uuid',
    'not_authorized'
  ),
  'a contracts manager cannot delete a drawing or archive a site'
);

delete from public.drawings where id = :'revnew'::uuid;
delete from storage.objects where bucket_id = 'drawings' and name = :'firmx' || '/' || :'sitea' || '/new.pdf';

reset role;
select pg_temp.ok(
  (select count(*) from public.drawings where id = :'revnew'::uuid) = 1
  and (select count(*) from storage.objects where name = :'firmx' || '/' || :'sitea' || '/new.pdf') = 1,
  'a contracts manager delete removes no drawing row and no file'
);

select pg_temp.jwt(:'opa'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises('select public.delete_drawing(' || quote_literal(:'revold') || '::uuid)', 'not_authorized')
  and pg_temp.raises('select public.archive_site(' || quote_literal(:'siteb') || '::uuid)', 'not_authorized')
  and pg_temp.raises('select public.restore_site(' || quote_literal(:'siteb') || '::uuid)', 'not_authorized'),
  'an operative cannot delete a drawing or archive or restore a site'
);

delete from public.drawings where id = :'revold'::uuid;
delete from storage.objects where bucket_id = 'drawings' and name = :'firmx' || '/' || :'sitea' || '/old.pdf';

reset role;
select pg_temp.ok(
  (select count(*) from public.drawings where id = :'revold'::uuid) = 1
  and (select count(*) from storage.objects where name = :'firmx' || '/' || :'sitea' || '/old.pdf') = 1,
  'an operative delete removes no drawing row and no file'
);

select pg_temp.jwt(:'ownery'::uuid);
set local role authenticated;

select pg_temp.ok(
  pg_temp.raises('select public.delete_drawing(' || quote_literal(:'revnew') || '::uuid)', 'drawing_not_found')
  and pg_temp.raises('select public.archive_site(' || quote_literal(:'sitea') || '::uuid)', 'site_not_found'),
  'an owner in another company cannot delete or archive this site'
);

delete from storage.objects where bucket_id = 'drawings' and name = :'firmx' || '/' || :'sitea' || '/keep.pdf';

reset role;
select pg_temp.ok(
  (select count(*) from storage.objects where name = :'firmx' || '/' || :'sitea' || '/keep.pdf') = 1,
  'storage delete does not cross companies'
);

select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

insert into probe (k, v)
values ('paths', to_jsonb(public.delete_drawing(:'revold'::uuid)));

select pg_temp.ok(
  (select v from probe where k = 'paths') ? (:'firmx' || '/' || :'sitea' || '/loose.pdf')
  and (select v from probe where k = 'paths') ? (:'firmx' || '/' || :'sitea' || '/old.pdf')
  and (select v from probe where k = 'paths') ? (:'firmx' || '/' || :'sitea' || '/new.pdf')
  and not ((select v from probe where k = 'paths') ? (:'firmx' || '/' || :'sitea' || '/keep.pdf'))
  and (select jsonb_array_length(v) from probe where k = 'paths') = 3,
  'delete_drawing returns every revision path and not the other sheet'
);

reset role;
select pg_temp.ok(
  (select count(*) from public.drawings where id in (:'revold'::uuid, :'revloose'::uuid, :'revnew'::uuid)) = 0
  and (select count(*) from public.drawings where id = :'revkeep'::uuid) = 1
  and (select count(*) from public.drawing_seen where drawing_id = :'revnew'::uuid) = 0
  and (select count(*) from public.drawing_revision_opens where drawing_id = :'revnew'::uuid) = 0
  and (select count(*) from public.drawing_requests where id = :'requesta'::uuid) = 1
  and (select fulfilled_drawing_id is null from public.drawing_requests where id = :'requesta'::uuid)
  and (select count(*) from public.drawing_file_orphans where company_id = :'firmx'::uuid) = 3,
  'the revision family is gone, the request stays, and orphan paths are recorded'
);

select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select cardinality(public.list_drawing_orphans())) = 3,
  'the owner can list the orphan paths'
);

delete from storage.objects
where bucket_id = 'drawings'
  and name in (
    :'firmx' || '/' || :'sitea' || '/loose.pdf',
    :'firmx' || '/' || :'sitea' || '/old.pdf',
    :'firmx' || '/' || :'sitea' || '/new.pdf'
  );

select public.clear_drawing_orphans(public.list_drawing_orphans());

reset role;
select pg_temp.ok(
  (select count(*) from storage.objects where name like :'firmx' || '/' || :'sitea' || '/%' and name <> :'firmx' || '/' || :'sitea' || '/keep.pdf') = 0
  and (select count(*) from public.drawing_file_orphans where company_id = :'firmx'::uuid) = 0
  and (select count(*) from storage.objects where name = :'firmx' || '/' || :'sitea' || '/keep.pdf') = 1,
  'the owner can delete the files and clear the orphan rows'
);

select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select public.archive_site(:'siteb'::uuid);

reset role;
select pg_temp.ok(
  (select archived_at is not null and archived_by = :'ownerx'::uuid from public.sites where id = :'siteb'::uuid)
  and (select count(*) from public.snags where site_id = :'siteb'::uuid) = 1
  and (select count(*) from public.variations where site_id = :'siteb'::uuid) = 1
  and (select count(*) from public.drawings where id = :'revb'::uuid) = 1,
  'archive keeps snags, variations, and drawings'
);

select pg_temp.jwt(:'opb'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.sites where id = :'siteb'::uuid) = 0
  and (select count(*) from public.drawings where site_id = :'siteb'::uuid) = 0
  and (select count(*) from public.snags where site_id = :'siteb'::uuid) = 0
  and (select count(*) from public.variations where site_id = :'siteb'::uuid) = 0,
  'a member cannot select an archived site or its rows'
);

select pg_temp.ok(
  pg_temp.raises('select public.list_snags(' || quote_literal(:'siteb') || '::uuid)', 'not_authorized')
  and pg_temp.raises(
    'select public.create_variation(' || quote_literal(:'siteb') || '::uuid, ''Extra'', ''Note'', null, null, null, ''[]''::jsonb)',
    'not_authorized'
  ),
  'a member cannot list snags or create a variation on an archived site'
);

select pg_temp.ok(
  pg_temp.raises(
    'insert into public.drawings (site_id, title, revision, storage_path) values ('
      || quote_literal(:'siteb') || '::uuid, ''Blocked'', ''A'', ''blocked.pdf'')',
    'site_archived'
  )
  and pg_temp.raises(
    'insert into public.drawing_requests (site_id, requester_id, body, status) values ('
      || quote_literal(:'siteb') || '::uuid, ' || quote_literal(:'opb') || '::uuid, ''Need this'', ''Open'')',
    'site_archived'
  )
  and pg_temp.raises(
    'insert into public.site_assignments (site_id, person_id) values ('
      || quote_literal(:'siteb') || '::uuid, ' || quote_literal(:'opa') || '::uuid)',
    'site_archived'
  ),
  'a member insert on an archived site is rejected'
);

select pg_temp.ok(
  pg_temp.raises(
    'insert into storage.objects (bucket_id, name) values (''drawings'', '
      || quote_literal(:'firmx' || '/' || :'siteb' || '/blocked.pdf') || ')',
    'new row violates row-level security policy for table "objects"'
  )
  and pg_temp.raises(
    'insert into storage.objects (bucket_id, name) values (''site-photos'', '
      || quote_literal(:'firmx' || '/' || :'siteb' || '/snags/a.jpg') || ')',
    'new row violates row-level security policy for table "objects"'
  ),
  'a member cannot upload a drawing or a photo to an archived site'
);

select pg_temp.jwt(:'cmx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.sites where id = :'siteb'::uuid) = 0
  and pg_temp.raises('select public.restore_site(' || quote_literal(:'siteb') || '::uuid)', 'not_authorized'),
  'a contracts manager cannot see or restore an archived site they are not restoring as owner'
);

select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.sites where id = :'siteb'::uuid) = 1
  and (select count(*) from public.snags where site_id = :'siteb'::uuid) = 1
  and (select count(*) from public.drawings where id = :'revb'::uuid) = 1
  and pg_temp.raises(
    'select public.replace_drawing('
      || quote_literal(:'siteb') || '::uuid, ''Blocked sheet'', ''A'', '
      || quote_literal(:'firmx' || '/' || :'siteb' || '/blocked.pdf')
      || ', ''B-9'', null, 100, ''application/pdf'', null, null, ''Other'', null)',
    'site_archived'
  )
  and pg_temp.raises(
    'insert into public.drawings (site_id, title, revision, storage_path) values ('
      || quote_literal(:'siteb') || '::uuid, ''Owner blocked'', ''A'', ''owner-blocked.pdf'')',
    'site_archived'
  )
  and pg_temp.raises(
    'insert into public.site_assignments (site_id, person_id) values ('
      || quote_literal(:'siteb') || '::uuid, ' || quote_literal(:'ownerx') || '::uuid)',
    'site_archived'
  ),
  'the owner can still read an archived site and cannot add drawings to it'
);

reset role;
select pg_temp.jwt(:'ownerx'::uuid);
select pg_temp.ok(
  pg_temp.raises(
    'insert into public.snags (site_id, company_id, snag_seq, note, trade_label, raised_by, raised_by_name, raised_at, status) values ('
      || quote_literal(:'siteb') || '::uuid, ' || quote_literal(:'firmx') || '::uuid, 2, ''Another'', ''Plaster'', '
      || quote_literal(:'ownerx') || '::uuid, ''Owner X'', now(), ''Open'')',
    'site_archived'
  ),
  'a bypass of RLS still cannot insert a snag on an archived site'
);

select pg_temp.jwt(:'ownerx'::uuid);
set local role authenticated;
select public.restore_site(:'siteb'::uuid);

reset role;
select pg_temp.ok(
  (select archived_at is null and archived_by is null from public.sites where id = :'siteb'::uuid),
  'the owner can restore'
);

select pg_temp.jwt(:'opb'::uuid);
set local role authenticated;

select pg_temp.ok(
  (select count(*) from public.sites where id = :'siteb'::uuid) = 1
  and (select count(*) from public.snags where site_id = :'siteb'::uuid) = 1
  and (select count(*) from public.drawings where id = :'revb'::uuid) = 1
  and (select count(*) from public.variations where site_id = :'siteb'::uuid) = 1,
  'a member can see the site again after restore'
);

insert into storage.objects (bucket_id, name)
values ('drawings', :'firmx' || '/' || :'siteb' || '/requests/note.jpg');

select pg_temp.ok(
  (select count(*) from storage.objects where name = :'firmx' || '/' || :'siteb' || '/requests/note.jpg') = 1,
  'a member can upload to the site once it is active'
);

rollback;
